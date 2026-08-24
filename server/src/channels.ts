import { config } from "./config";
import { getAppChannel, setAppChannel } from "./repo";
import type { ChannelRole } from "./repo";

/**
 * The two Telegram channels Navaar keeps its media in.
 *
 * Audio has always lived on Telegram — a track row stores a file_id and the
 * bytes never touch this server's database. Cover art was the exception, held
 * inline as BYTEA, which is the one thing here that grows with the library.
 * The cover channel closes that gap: a cover is posted once as a photo and
 * what gets written down is the file_id, exactly as for audio.
 *
 * The log channel is the other half, and is for people rather than for the
 * app: every track that lands in Navaar is posted there with a caption saying
 * what it is and who sent it, so there is somewhere to browse and re-download
 * the library from that is not a database.
 *
 * Nothing in this module is allowed to fail a caller. A cover that could not be
 * posted falls back to the bytes path; a log line that could not be written is
 * a warning. The rule audio-ingest already states about Telegram — that it is
 * weather, not authority — applies to both.
 */

const API = "https://api.telegram.org";

/**
 * Channels are recognised by what they are called.
 *
 * The bot is an admin of both, so every post and every membership change hands
 * it the channel's id and title unprompted. Matching on the title means the
 * setup is "make the bot an admin, post anything" rather than "find a -100…
 * number and paste it into a dashboard" — and once matched the id is written
 * down, so a later rename cannot unstick it.
 */
const ROLE_PATTERNS: { role: ChannelRole; test: (title: string) => boolean }[] = [
  { role: "covers", test: (t) => t.includes("photo") || t.includes("cover") },
  { role: "logs", test: (t) => t.includes("log") },
];

/**
 * Resolved ids, held for the life of the process.
 *
 * The lookup is a database round trip on a path — serving a cover — that is
 * already two round trips to Telegram, and the answer changes about as often as
 * somebody creates a channel. A miss is not cached, so the first post in a
 * newly created channel takes effect immediately.
 */
const cache = new Map<ChannelRole, number>();

/** Lowercased and stripped of punctuation, so "Navaar: Photo Booth" matches. */
function normalise(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

export function roleForChannelTitle(title: string | undefined): ChannelRole | null {
  if (!title) return null;
  const name = normalise(title);
  // Only Navaar's own channels are claimed. The bot may well be an admin of
  // something else entirely, and a channel called "Tour Logs" is not an
  // invitation to start writing to it.
  if (!name.includes("navaar") && !name.includes("navar")) return null;
  return ROLE_PATTERNS.find((p) => p.test(name))?.role ?? null;
}

/**
 * Records a channel the bot has just heard from, if it is one of ours.
 *
 * Called on every channel update rather than only on the first, which makes it
 * self-healing: point the bot at a new channel with the right name and the next
 * post moves the role over.
 */
export async function noteChannel(chat: {
  id: number;
  type: string;
  title?: string;
}): Promise<void> {
  if (chat.type !== "channel") return;
  const role = roleForChannelTitle(chat.title);
  if (!role) return;

  if (cache.get(role) === chat.id) return;
  try {
    await setAppChannel(role, chat.id, chat.title ?? null);
    cache.set(role, chat.id);
    console.log(
      `[channels] ${role} channel is "${chat.title}" (${chat.id})`
    );
  } catch (err) {
    console.warn(`[channels] could not record ${role} channel:`, err);
  }
}

async function channelId(role: ChannelRole): Promise<number | null> {
  const override = role === "covers" ? config.coverChannelId : config.logChannelId;
  if (override) return override;

  const cached = cache.get(role);
  if (cached !== undefined) return cached;

  try {
    const id = await getAppChannel(role);
    if (id !== null) cache.set(role, id);
    return id;
  } catch (err) {
    console.warn(`[channels] could not look up ${role} channel:`, err);
    return null;
  }
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function callBotApi<T>(
  method: string,
  body: FormData
): Promise<T | null> {
  if (!config.botToken) return null;
  const res = await fetch(`${API}/bot${config.botToken}/${method}`, {
    method: "POST",
    body,
  });
  const data = (await res.json()) as TelegramResponse<T>;
  if (!data.ok || data.result === undefined) {
    throw new Error(data.description ?? `${method} failed`);
  }
  return data.result;
}

interface PhotoSize {
  file_id: string;
  width: number;
  height: number;
}

/**
 * Puts a cover in the cover channel and returns the file_id to store.
 *
 * Sent as a photo rather than a document on purpose. Telegram re-encodes to
 * JPEG and caps the long edge, which turns a 2MB embedded cover into something
 * around a couple of hundred kilobytes — still far more resolution than the
 * 196px hero this app draws at its largest — and it means every byte that ever
 * comes back out of this endpoint is a JPEG that Telegram itself produced,
 * which is a stronger guarantee than any mime allowlist.
 *
 * Returns null rather than throwing: every caller has a bytes fallback, and a
 * cover is never worth failing an ingest or an upload over.
 */
export async function postCoverPhoto(
  image: Buffer,
  mimeType: string,
  caption?: string
): Promise<string | null> {
  const chatId = await channelId("covers");
  if (!chatId) return null;

  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) form.append("caption", truncate(caption, CAPTION_LIMIT));
    form.append(
      "photo",
      new Blob([new Uint8Array(image)], { type: mimeType }),
      "cover.jpg"
    );

    const message = await callBotApi<{ photo?: PhotoSize[] }>("sendPhoto", form);
    const sizes = message?.photo;
    if (!sizes?.length) return null;

    // Telegram returns the thumbnails ascending; the last is the full-size one.
    return sizes.reduce((biggest, size) =>
      size.width * size.height > biggest.width * biggest.height ? size : biggest
    ).file_id;
  } catch (err) {
    console.warn("[channels] could not post cover:", err);
    return null;
  }
}

/** Telegram's hard limit on a caption. */
const CAPTION_LIMIT = 1024;

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * A caption, one fact per line, skipping the facts there were none of.
 *
 * Everything that reaches these channels says what it is and whose it is. A
 * channel of unlabelled album art is a pile rather than an archive: there is
 * no telling whose cover you are looking at, or which of two similar squares
 * belongs to the playlist you were trying to fix.
 */
export function captionOf(lines: (string | null | undefined)[]): string {
  const kept = lines.filter((line): line is string => !!line);
  return truncate(kept.join("\n"), CAPTION_LIMIT);
}

/**
 * How a person is named in a caption. The id is the fallback rather than the
 * first choice because a Telegram username is optional and can be changed.
 */
export function personLabel(
  telegramId: number | string,
  username: string | null | undefined
): string {
  return username ? `@${username}` : `id ${telegramId}`;
}

export interface LoggedTrack {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_seconds: number | null;
  telegram_file_id: string;
}

export interface LogSource {
  senderId: number;
  username?: string;
  /** The group it was posted in, when it was not a direct message. */
  groupTitle?: string;
}

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/**
 * Posts a newly ingested track to the log channel.
 *
 * The audio is passed along by file_id, so nothing is uploaded a second time —
 * this costs one API call and no bandwidth. Fire-and-forget by design: the
 * caller has already told the user their track landed, and an archive that
 * missed a line is not a reason to say otherwise.
 */
export async function logIngestedTrack(
  track: LoggedTrack,
  source: LogSource
): Promise<void> {
  const chatId = await channelId("logs");
  if (!chatId) return;

  const caption = captionOf([
    track.title ?? "Untitled",
    track.artist ?? "Unknown artist",
    track.album ? `Album: ${track.album}` : null,
    formatDuration(track.duration_seconds),
    `Added by ${personLabel(source.senderId, source.username)}` +
      (source.groupTitle ? ` in “${source.groupTitle}”` : ""),
    track.id,
  ]);

  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("audio", track.telegram_file_id);
    form.append("caption", caption);
    if (track.title) form.append("title", track.title);
    if (track.artist) form.append("performer", track.artist);
    await callBotApi("sendAudio", form);
  } catch (err) {
    console.warn("[channels] could not log track:", err);
  }
}
