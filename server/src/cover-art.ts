import { getTelegramFileDownloadUrl } from "./telegram-files";

export interface CoverArt {
  image: Buffer;
  mimeType: string;
}

export interface CoverArtSource {
  /** file_id of the audio file itself. */
  fileId: string;
  /** file_id of the album-cover thumbnail Telegram derived, if the message had one. */
  thumbFileId?: string;
}

/** ID3v2 tags sit at the head of the file, so only this much is ever read. */
const MAX_TAG_BYTES = 4 * 1024 * 1024;
/** Keeps a pathologically large embedded image out of Postgres. */
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/**
 * Finds the album art for a track.
 *
 * The picture embedded in the audio file is preferred: it is full resolution,
 * and it can be recovered from a stored file_id alone, which is what lets
 * tracks ingested before covers were captured be backfilled. Telegram's own
 * album-cover thumbnail (320px, and only available on the original message) is
 * the fallback for formats whose tags this doesn't parse.
 *
 * Never throws — a missing cover must not fail an ingest.
 */
export async function resolveCoverArt(
  source: CoverArtSource
): Promise<CoverArt | null> {
  try {
    const embedded = await readEmbeddedCover(source.fileId);
    if (embedded) return embedded;
  } catch (err) {
    console.warn("[cover-art] embedded artwork lookup failed:", err);
  }

  if (!source.thumbFileId) return null;
  try {
    return await readThumbnail(source.thumbFileId);
  } catch (err) {
    console.warn("[cover-art] thumbnail lookup failed:", err);
    return null;
  }
}

/**
 * Reads only the ID3v2 tag off the front of the file — two ranged requests,
 * never the audio payload.
 */
async function readEmbeddedCover(fileId: string): Promise<CoverArt | null> {
  const url = await getTelegramFileDownloadUrl(fileId);

  const header = await readRange(url, 0, 9);
  if (!header || header.length < 10) return null;
  if (header.toString("latin1", 0, 3) !== "ID3") return null;

  const tagSize = readSynchsafe(header, 6);
  if (tagSize <= 0 || tagSize > MAX_TAG_BYTES) return null;

  const body = await readRange(url, 10, 10 + tagSize - 1);
  if (!body) return null;

  return findPictureFrame(header[3], header[5], body);
}

async function readThumbnail(fileId: string): Promise<CoverArt | null> {
  const url = await getTelegramFileDownloadUrl(fileId);
  const res = await fetch(url);
  if (!res.ok) return null;

  const image = Buffer.from(await res.arrayBuffer());
  const mimeType = sniffImageMime(image);
  if (!mimeType || image.length > MAX_COVER_BYTES) return null;
  return { image, mimeType };
}

/** Inclusive byte range, mirroring the Range header's semantics. */
async function readRange(
  url: string,
  start: number,
  end: number
): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // A server that ignores Range answers 200 with the whole file; slice it
  // ourselves so the caller always gets the window it asked for.
  return res.status === 206 ? buf : buf.subarray(start, end + 1);
}

/**
 * Walks the tag's frames looking for an attached picture, preferring the frame
 * marked "front cover" (picture type 3) over whatever else is attached.
 */
function findPictureFrame(
  majorVersion: number,
  tagFlags: number,
  raw: Buffer
): CoverArt | null {
  const body = (tagFlags & 0x80) !== 0 ? deunsynchronise(raw) : raw;

  let offset = 0;
  if ((tagFlags & 0x40) !== 0) {
    // Extended header: v2.3 stores a plain size excluding the size field,
    // v2.4 a synchsafe size that includes it.
    if (body.length < 4) return null;
    offset =
      majorVersion === 3 ? 4 + body.readUInt32BE(0) : readSynchsafe(body, 0);
  }

  const idLength = majorVersion === 2 ? 3 : 4;
  const headerLength = majorVersion === 2 ? 6 : 10;
  let fallback: CoverArt | null = null;

  while (offset + headerLength <= body.length) {
    if (body[offset] === 0) break; // padding after the last frame

    const id = body.toString("latin1", offset, offset + idLength);
    const size = readFrameSize(body, offset + idLength, majorVersion);
    const start = offset + headerLength;
    const end = start + size;
    if (size <= 0 || end > body.length) break;

    if (id === "APIC" || id === "PIC") {
      const found = parsePictureFrame(
        body.subarray(start, end),
        majorVersion === 2
      );
      if (found) {
        if (found.frontCover) return found.cover;
        fallback ??= found.cover;
      }
    }

    offset = end;
  }

  return fallback;
}

function readFrameSize(
  body: Buffer,
  offset: number,
  majorVersion: number
): number {
  if (majorVersion === 2) {
    return (body[offset] << 16) | (body[offset + 1] << 8) | body[offset + 2];
  }
  // Only v2.4 stores frame sizes synchsafe; v2.3 uses a plain 32-bit integer.
  return majorVersion >= 4
    ? readSynchsafe(body, offset)
    : body.readUInt32BE(offset);
}

/**
 * APIC layout: text encoding, MIME type, picture type, description, then the
 * image bytes. The v2.2 equivalent (PIC) swaps the MIME string for a
 * 3-character format code.
 */
function parsePictureFrame(
  frame: Buffer,
  isV22: boolean
): { cover: CoverArt; frontCover: boolean } | null {
  if (frame.length < 5) return null;

  const encoding = frame[0];
  let cursor = 1;
  let declaredFormat: string;

  if (isV22) {
    declaredFormat = frame.toString("latin1", cursor, cursor + 3);
    cursor += 3;
  } else {
    const terminator = frame.indexOf(0, cursor);
    if (terminator < 0) return null;
    declaredFormat = frame.toString("latin1", cursor, terminator);
    cursor = terminator + 1;
  }

  // "-->" means the frame carries a URL rather than image bytes.
  if (declaredFormat === "-->") return null;

  const pictureType = frame[cursor];
  cursor += 1;

  cursor = skipDescription(frame, cursor, encoding);
  if (cursor < 0 || cursor >= frame.length) return null;

  const image = frame.subarray(cursor);
  // Trust the bytes over the declared format — tags routinely lie ("JPG",
  // "image/jpg", or nothing at all).
  const mimeType = sniffImageMime(image);
  if (!mimeType || image.length > MAX_COVER_BYTES) return null;

  // Copy so the whole multi-megabyte tag isn't retained by the view.
  return {
    cover: { image: Buffer.from(image), mimeType },
    frontCover: pictureType === 3,
  };
}

/** Returns the offset just past the description string, or -1 if unterminated. */
function skipDescription(
  frame: Buffer,
  start: number,
  encoding: number
): number {
  // Encodings 1 and 2 are UTF-16, terminated by two zero bytes on an even
  // boundary relative to the string's start.
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < frame.length; i += 2) {
      if (frame[i] === 0 && frame[i + 1] === 0) return i + 2;
    }
    return -1;
  }
  const terminator = frame.indexOf(0, start);
  return terminator < 0 ? -1 : terminator + 1;
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf.toString("latin1", 1, 4) === "PNG"
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Undoes ID3's unsynchronisation scheme: every 0xFF 0x00 pair becomes 0xFF. */
function deunsynchronise(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  let written = 0;
  for (let i = 0; i < buf.length; i++) {
    out[written++] = buf[i];
    if (buf[i] === 0xff && buf[i + 1] === 0x00) i++;
  }
  return out.subarray(0, written);
}

/** ID3 sizes are 28-bit integers stored as four 7-bit groups. */
function readSynchsafe(buf: Buffer, offset: number): number {
  return (
    (buf[offset] << 21) |
    (buf[offset + 1] << 14) |
    (buf[offset + 2] << 7) |
    buf[offset + 3]
  );
}
