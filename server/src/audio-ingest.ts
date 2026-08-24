import { randomUUID } from "node:crypto";
import {
  createTrackInGroupCrate,
  createTrackInSession,
  ensureUser,
  purgeExpiredTracks,
} from "./repo";
import type { IngestSession, NewTrack } from "./repo";
import { readAudioTags } from "./cover-art";
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
 * Everything that happens to a file before it is written down, which is the
 * same wherever the file was posted: the size check, and the one pass over its
 * tag header.
 *
 * The audio itself is never downloaded or copied anywhere — only the header is
 * read, to lift out the album art and what the file says about itself.
 * Streaming later re-resolves the file_id through the Bot API on demand.
 *
 * Only one thing here is allowed to fail an ingest, and that is the file being
 * bigger than the Bot API will ever hand over. Everything else about Telegram
 * is treated as weather: the row we are about to write stores a file_id, not
 * bytes, and every reader of that file_id resolves it again when it needs it.
 * A getFile that is rate-limited or briefly unavailable at this moment says
 * nothing about whether the track can be played in a minute's time, so it must
 * not be the reason a forwarded track is refused.
 */
async function prepareTrack(
  ownerTelegramId: number,
  username: string | undefined,
  audio: IncomingAudio
): Promise<NewTrack> {
  await ensureUser(ownerTelegramId, username);

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

  return {
    id: randomUUID(),
    ownerTelegramId,
    title: audio.title ?? tags.title ?? fallbackTitle ?? null,
    artist: audio.performer ?? tags.artist ?? null,
    album: tags.album,
    durationSeconds: audio.durationSeconds ?? null,
    telegramFileId: audio.fileId,
    mimeType: audio.mimeType ?? null,
    coverImage: tags.cover?.image ?? null,
    coverMimeType: tags.cover?.mimeType ?? null,
    // A fresh ingest is the origin by definition; the save path overrides this.
    originAdderId: ownerTelegramId,
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
): Promise<{ track: Track; session: IngestSession | null }> {
  return createTrackInSession(
    await prepareTrack(ownerTelegramId, username, audio)
  );
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
): Promise<{ track: Track; position: number | null }> {
  return createTrackInGroupCrate(
    await prepareTrack(senderTelegramId, username, audio),
    cratePlaylistId
  );
}
