import { randomUUID } from "node:crypto";
import type { Telegraf } from "telegraf";
import { createTrack, ensureUser } from "./repo";
import type { Track } from "./types";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export interface IncomingAudio {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  performer?: string;
  title?: string;
  durationSeconds?: number;
  fileSize?: number;
}

export class AudioTooLargeError extends Error {}

/**
 * Records a track pointing at the file Telegram already stores — no bytes
 * are downloaded or copied anywhere. Streaming later re-resolves the
 * file_id through the Bot API on demand.
 */
export async function ingestAudioMessage(
  bot: Telegraf,
  ownerTelegramId: number,
  username: string | undefined,
  audio: IncomingAudio
): Promise<Track> {
  await ensureUser(ownerTelegramId, username);

  if (audio.fileSize && audio.fileSize > MAX_FILE_SIZE_BYTES) {
    throw new AudioTooLargeError(
      "File exceeds Telegram's 20MB Bot API download limit."
    );
  }

  try {
    // Confirms the file is actually fetchable (and catches the "too big"
    // case when Telegram didn't report a file_size up front).
    await bot.telegram.getFile(audio.fileId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("too big")) {
      throw new AudioTooLargeError(
        "File exceeds Telegram's 20MB Bot API download limit."
      );
    }
    throw err;
  }

  const fallbackTitle = audio.fileName?.replace(/\.[a-zA-Z0-9]+$/, "");

  return createTrack({
    id: randomUUID(),
    ownerTelegramId,
    title: audio.title ?? fallbackTitle ?? null,
    artist: audio.performer ?? null,
    album: null,
    durationSeconds: audio.durationSeconds ?? null,
    telegramFileId: audio.fileId,
    mimeType: audio.mimeType ?? null,
  });
}
