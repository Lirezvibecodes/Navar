import { required } from "./config";

interface TelegramGetFileResponse {
  ok: boolean;
  result?: { file_path?: string };
  description?: string;
}

/** Resolves a Telegram file_id to a time-limited download URL via the Bot API. */
export async function getTelegramFileDownloadUrl(fileId: string): Promise<string> {
  const token = required("BOT_TOKEN");
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = (await res.json()) as TelegramGetFileResponse;
  if (!data.ok || !data.result?.file_path) {
    throw new Error(data.description ?? "Telegram getFile failed");
  }
  return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}
