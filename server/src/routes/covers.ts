import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { postCoverPhoto } from "../channels";
import { getTelegramFileDownloadUrl } from "../telegram-files";
import type { CoverSource } from "../repo";

/**
 * Reading and writing cover art, for the two routers that serve it.
 *
 * A cover now normally lives in the cover channel as a file_id, but tracks
 * ingested before that still hold their bytes, and an upload that Telegram
 * refused falls back to holding them too. Both halves are here so the two
 * routes cannot drift into answering the same question differently.
 */

/**
 * Puts an uploaded image wherever it can go, preferring the channel.
 *
 * The mime type only matters on the fallback path — anything that reaches
 * Telegram comes back as a JPEG Telegram itself produced — but the caller
 * validates it before calling either way, because the fallback is not a rare
 * enough path to leave unguarded.
 */
export async function storeCover(
  image: Buffer,
  mimeType: string
): Promise<CoverSource> {
  const fileId = await postCoverPhoto(image, mimeType);
  return fileId
    ? { kind: "telegram", fileId }
    : { kind: "bytes", image, mimeType };
}

/**
 * Serves a cover, from wherever it turned out to live.
 *
 * The ETag is what makes this affordable. A cover held on Telegram costs a
 * getFile and a download per request where it used to cost one indexed read,
 * and a library screen asks for dozens at once — so the identity of the
 * picture is published up front and a revalidating client is answered 304
 * before Telegram is contacted at all. The max-age is deliberately short: the
 * URL is stable across a change of cover, so freshness has to come from the
 * revalidation rather than from the cache window.
 */
export async function serveCover(
  cover: CoverSource | null,
  req: Request,
  res: Response
): Promise<void> {
  if (!cover) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const etag = `"${cover.kind === "telegram" ? cover.fileId : hashOf(cover.image)}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=60, must-revalidate");

  if (req.header("if-none-match") === etag) {
    res.status(304).end();
    return;
  }

  if (cover.kind === "bytes") {
    res.setHeader("Content-Type", cover.mimeType ?? "image/jpeg");
    res.send(cover.image);
    return;
  }

  const upstream = await fetch(await getTelegramFileDownloadUrl(cover.fileId));
  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: "Failed to fetch cover from Telegram" });
    return;
  }

  // Always a JPEG: it is what sendPhoto produces, whatever went in.
  res.setHeader("Content-Type", "image/jpeg");
  const length = upstream.headers.get("content-length");
  if (length) res.setHeader("Content-Length", length);
  Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
}

/**
 * A cheap identity for a blob of bytes. Not a checksum — it only has to change
 * when the picture does, and only for the stored-bytes covers that are on their
 * way out anyway.
 */
function hashOf(image: Buffer): string {
  let hash = 0;
  for (let i = 0; i < image.length; i += 64) hash = (hash * 31 + image[i]) | 0;
  return `${image.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}
