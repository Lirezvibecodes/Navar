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
 * What a track's own tag header says about it.
 *
 * The album is the reason this exists: Telegram's audio message carries a
 * performer and a title but never an album, and /album needs one to name the
 * batch after. Reading it costs nothing extra — it comes out of the same two
 * ranged requests the cover already required.
 */
export interface AudioTags {
  cover: CoverArt | null;
  album: string | null;
  artist: string | null;
  title: string | null;
}

const NO_TAGS: AudioTags = { cover: null, album: null, artist: null, title: null };

/**
 * Reads the tag header off the front of a file: artwork, and the text frames
 * worth having. Never throws — a file whose tags cannot be parsed still gets
 * ingested, just with less known about it.
 */
export async function readAudioTags(source: CoverArtSource): Promise<AudioTags> {
  let tags = NO_TAGS;
  try {
    tags = (await readEmbeddedTags(source.fileId)) ?? NO_TAGS;
  } catch (err) {
    console.warn("[cover-art] tag read failed:", err);
  }

  if (tags.cover || !source.thumbFileId) return tags;

  try {
    return { ...tags, cover: await readThumbnail(source.thumbFileId) };
  } catch (err) {
    console.warn("[cover-art] thumbnail lookup failed:", err);
    return tags;
  }
}

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
  return (await readAudioTags(source)).cover;
}

/**
 * Reads only the ID3v2 tag off the front of the file — two ranged requests,
 * never the audio payload.
 */
async function readEmbeddedTags(fileId: string): Promise<AudioTags | null> {
  const url = await getTelegramFileDownloadUrl(fileId);

  const header = await readRange(url, 0, 9);
  if (!header || header.length < 10) return null;
  if (header.toString("latin1", 0, 3) !== "ID3") return null;

  const tagSize = readSynchsafe(header, 6);
  if (tagSize <= 0 || tagSize > MAX_TAG_BYTES) return null;

  const body = await readRange(url, 10, 10 + tagSize - 1);
  if (!body) return null;

  return collectTags(header[3], header[5], body);
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
 * Walks the tag's frames once, collecting the attached picture and the text
 * frames worth keeping. The picture marked "front cover" (type 3) wins over
 * whatever else is attached; the first text frame of a given kind wins, since
 * duplicates are almost always a broken writer rather than a second value.
 */
function collectTags(
  majorVersion: number,
  tagFlags: number,
  raw: Buffer
): AudioTags {
  const body = (tagFlags & 0x80) !== 0 ? deunsynchronise(raw) : raw;

  let offset = 0;
  if ((tagFlags & 0x40) !== 0) {
    // Extended header: v2.3 stores a plain size excluding the size field,
    // v2.4 a synchsafe size that includes it.
    if (body.length < 4) return NO_TAGS;
    offset =
      majorVersion === 3 ? 4 + body.readUInt32BE(0) : readSynchsafe(body, 0);
  }

  const isV22 = majorVersion === 2;
  const idLength = isV22 ? 3 : 4;
  const headerLength = isV22 ? 6 : 10;

  // v2.2 abbreviates every frame id to three characters.
  const TEXT_FRAMES: Record<string, keyof AudioTags> = isV22
    ? { TAL: "album", TP1: "artist", TT2: "title" }
    : { TALB: "album", TPE1: "artist", TIT2: "title" };

  const tags: AudioTags = { cover: null, album: null, artist: null, title: null };
  let frontCoverFound = false;

  while (offset + headerLength <= body.length) {
    if (body[offset] === 0) break; // padding after the last frame

    const id = body.toString("latin1", offset, offset + idLength);
    const size = readFrameSize(body, offset + idLength, majorVersion);
    const start = offset + headerLength;
    const end = start + size;
    if (size <= 0 || end > body.length) break;

    if (!frontCoverFound && (id === "APIC" || id === "PIC")) {
      const found = parsePictureFrame(body.subarray(start, end), isV22);
      if (found && (found.frontCover || !tags.cover)) {
        tags.cover = found.cover;
        frontCoverFound = found.frontCover;
      }
    } else {
      const field = TEXT_FRAMES[id];
      if (field && field !== "cover" && !tags[field]) {
        tags[field] = decodeTextFrame(body.subarray(start, end));
      }
    }

    offset = end;
  }

  return tags;
}

/**
 * An ID3 text frame: one encoding byte, then the string. Values are routinely
 * padded with trailing NULs, and v2.4 uses NUL as a separator for multi-value
 * frames — only the first value is wanted either way.
 */
function decodeTextFrame(frame: Buffer): string | null {
  if (frame.length < 2) return null;
  const body = frame.subarray(1);

  let text: string;
  switch (frame[0]) {
    case 0:
      text = body.toString("latin1");
      break;
    case 1:
      text = decodeUtf16(body);
      break;
    case 2:
      text = decodeUtf16(body, true);
      break;
    case 3:
      text = body.toString("utf8");
      break;
    default:
      return null;
  }

  const value = text.split("\u0000")[0].trim();
  return value.length > 0 ? value : null;
}

/**
 * Encoding 1 carries a byte-order mark; encoding 2 is big-endian with none.
 * Node only decodes UTF-16LE, so big-endian input is byte-swapped first.
 */
function decodeUtf16(buf: Buffer, assumeBigEndian = false): string {
  let body = buf;
  let bigEndian = assumeBigEndian;

  if (body.length >= 2) {
    if (body[0] === 0xff && body[1] === 0xfe) {
      body = body.subarray(2);
      bigEndian = false;
    } else if (body[0] === 0xfe && body[1] === 0xff) {
      body = body.subarray(2);
      bigEndian = true;
    }
  }

  // swap16 throws on an odd length, which a truncated frame can produce.
  if (body.length % 2 !== 0) body = body.subarray(0, body.length - 1);
  return (bigEndian ? Buffer.from(body).swap16() : body).toString("utf16le");
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
