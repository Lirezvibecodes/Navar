import { randomUUID } from "node:crypto";
import {
  createTrackInGroupCrate,
  createTrackInSession,
  ensureUser,
  findTrackByFileId,
  purgeExpiredTracks,
} from "./repo";
import type { IngestSession, NewTrack } from "./repo";
import { readAudioTags } from "./cover-art";
import { captionOf, personLabel, postCoverPhoto } from "./channels";
import { getTelegramFileDownloadUrl } from "./telegram-files";
import type { Track } from "./types";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * Soft-deleted tracks past their undo window have to be swept by something,
 * and the free tier has no scheduler. Ingest is the hook: a user is present,
 * nothing is waiting on a render, and it happens often enough that tombstones
 * never pile up. Throttled so a forty-file batch does not run forty sweeps.
 */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastPurgeAt = 0;

function maybePurgeExpiredTracks(): void {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  void purgeExpiredTracks().catch((err) => {
    console.warn("[ingest] expired-track sweep failed:", err);
  });
}

export interface IncomingAudio {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  performer?: string;
  title?: string;
  durationSeconds?: number;
  fileSize?: number;
  /** Album-cover thumbnail Telegram derived for the message, when there was one. */
  thumbFileId?: string;
}

export class AudioTooLargeError extends Error {}

/**
 * Thrown when the file being ingested is already in this owner's library — a
 * genuine re-forward of the same Telegram file, identified by file_id rather
 * than by title/artist, since a retagged or re-encoded copy of the same song
 * is a different file and deliberately not flagged. Carries the row that was
 * already there, so the caller can point at it instead of running a second
 * lookup.
 */
export class DuplicateTrackError extends Error {
  constructor(public readonly existing: Track) {
    super("This file is already in the library.");
  }
}

/**
 * Everything that happens to a file before it is written down, which is the
 * same wherever the file was posted: the duplicate check, the size check, and
 * the one pass over its tag header.
 *
 * The audio itself is never downloaded or copied anywhere — only the header is
 * read, to lift out the album art and what the file says about itself.
 * Streaming later re-resolves the file_id through the Bot API on demand.
 *
 * Only one thing here is allowed to fail an ingest outright, and that is the
 * file being bigger than the Bot API will ever hand over (a duplicate isn't a
 * failure either — it's reported back, not thrown past). Everything else
 * about Telegram is treated as weather: the row we are about to write stores
 * a file_id, not bytes, and every reader of that file_id resolves it again
 * when it needs it. A getFile that is rate-limited or briefly unavailable at
 * this moment says nothing about whether the track can be played in a
 * minute's time, so it must not be the reason a forwarded track is refused.
 */
async function prepareTrack(
  ownerTelegramId: number,
  username: string | undefined,
  audio: IncomingAudio
): Promise<{ input: NewTrack; incompleteMetadata: boolean }> {
  await ensureUser(ownerTelegramId, username);

  // Caught before the size check or a tag read, so noticing a re-forward
  // costs nothing beyond the one lookup it takes to know.
  const existing = await findTrackByFileId(ownerTelegramId, audio.fileId);
  if (existing) throw new DuplicateTrackError(existing);

  if (audio.fileSize && audio.fileSize > MAX_FILE_SIZE_BYTES) {
    throw new AudioTooLargeError(
      "File exceeds Telegram's 20MB Bot API download limit."
    );
  }

  // Resolving the download URL up front does two things: it catches the "too
  // big" answer for the files Telegram did not report a size for, and it warms
  // the URL cache that the tag read is about to want — so ingesting a track
  // costs one getFile rather than the two it used to.
  try {
    await getTelegramFileDownloadUrl(audio.fileId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("too big")) {
      throw new AudioTooLargeError(
        "File exceeds Telegram's 20MB Bot API download limit."
      );
    }
    console.warn("[ingest] could not resolve file up front:", message);
  }

  maybePurgeExpiredTracks();

  const fallbackTitle = audio.fileName?.replace(/\.[a-zA-Z0-9]+$/, "");
  // Telegram's own metadata is preferred where it exists — it is what the user
  // saw in the chat — and the file's tags fill the gaps. Only the tags carry an
  // album, which is what /album groups a batch by.
  const tags = await readAudioTags(audio);

  const title = audio.title ?? tags.title ?? fallbackTitle ?? null;
  const artist = audio.performer ?? tags.artist ?? null;

  // "Incomplete" means neither field the rest of the UI is built around came
  // through — Telegram's own metadata and the file's embedded tags both came
  // up empty. A title with no artist (or the reverse) still has something to
  // show, so only the double-miss is flagged; the track is written down
  // either way, since a missing tag is never a reason to refuse a file.
  const incompleteMetadata = !title && !artist;

  // The artwork goes to the cover channel and only its file_id is written
  // down, so a library's worth of covers costs the database a few hundred
  // bytes rather than a few hundred megabytes. A channel that is unset or
  // unreachable simply leaves the bytes where they used to go.
  const id = randomUUID();
  const coverFileId = tags.cover
    ? await postCoverPhoto(
        tags.cover.image,
        tags.cover.mimeType,
        captionOf([
          [title, artist].filter(Boolean).join(" — ") || "Untitled",
          tags.album ? `Album: ${tags.album}` : null,
          `Added by ${personLabel(ownerTelegramId, username)}`,
          id,
        ])
      )
    : null;

  return {
    input: {
      id,
      ownerTelegramId,
      title,
      artist,
      album: tags.album,
      durationSeconds: audio.durationSeconds ?? null,
      telegramFileId: audio.fileId,
      mimeType: audio.mimeType ?? null,
      coverImage: coverFileId ? null : tags.cover?.image ?? null,
      coverMimeType: coverFileId ? null : tags.cover?.mimeType ?? null,
      coverFileId,
      // A fresh ingest is the origin by definition; the save path overrides this.
      originAdderId: ownerTelegramId,
    },
    incompleteMetadata,
  };
}

/**
 * A file sent to the bot in a direct message.
 *
 * Returns the sender's open batch alongside the track, when there is one: the
 * session is read inside the same transaction as the insert, so this is the
 * only trustworthy answer to "did that file land in a batch".
 */
export async function ingestAudioMessage(
  ownerTelegramId: number,
  username: string | undefined,
  audio: IncomingAudio
): Promise<{ track: Track; session: IngestSession | null; incompleteMetadata: boolean }> {
  const { input, incompleteMetadata } = await prepareTrack(
    ownerTelegramId,
    username,
    audio
  );
  const result = await createTrackInSession(input);
  return { ...result, incompleteMetadata };
}

/**
 * A file posted in a group the bot is in.
 *
 * The track belongs to the person who posted it, exactly as in a direct
 * message, and is additionally filed into that chat's shared crate. A batch
 * session the sender happens to have open in their DMs is deliberately not
 * consulted: /playlist is a conversation between one person and the bot, and a
 * group post is not part of it.
 */
export async function ingestGroupAudioMessage(
  senderTelegramId: number,
  username: string | undefined,
  audio: IncomingAudio,
  cratePlaylistId: string
): Promise<{ track: Track; position: number | null; incompleteMetadata: boolean }> {
  const { input, incompleteMetadata } = await prepareTrack(
    senderTelegramId,
    username,
    audio
  );
  const result = await createTrackInGroupCrate(input, cratePlaylistId);
  return { ...result, incompleteMetadata };
}
