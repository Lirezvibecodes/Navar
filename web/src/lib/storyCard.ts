import { trackCoverUrl } from "../api";
import { drawPixelatedWash as drawWash } from "./pixelWash";
import { formatListened } from "./format";
import type { ListeningStatsPage, Track } from "../types";

/**
 * Renders a track as a Telegram/Instagram story: cover art over a pixelated
 * wash of the same image, title and artist, up to eight picked lyric lines,
 * and the Navaar wordmark. Fixed at the platform's own story aspect (9:16)
 * so it needs no cropping on either end once it lands there.
 *
 * `drawStoryFrame` is the shared painter behind both outputs: a single still
 * card (`renderStoryCard`, mode "static") and every frame of the karaoke
 * video (`storyVideo.ts`, mode "highlight") — same background, same type,
 * same lyric layout, so a video's frames never jitter against each other and
 * never look like a different card than the still image does.
 */

const WIDTH = 1080;
const HEIGHT = 1920;

/** The canvas size every story frame is drawn at — exported so the video
 *  pipeline (`storyVideo.ts`) can size its own canvas to match. */
export const STORY_WIDTH = WIDTH;
export const STORY_HEIGHT = HEIGHT;
const COVER_SIZE = 760;
const COVER_RADIUS = 28;
const COVER_Y = 300;

/** Background wash resolution before it's blown back up with smoothing off —
 *  low enough that each block reads as a visible pixel, matching the rest of
 *  the app's pixel-art fallback art rather than a smooth photo blur. A light
 *  blur pass on top of the blocks softens their hard edges without losing
 *  the pixelation itself. */
const WASH_PIXEL_W = 54;
const WASH_BLUR_PX = 8;

const MAX_LYRIC_LINES = 8;
const LYRIC_FONT = '700 36px "General Sans"';
const LYRIC_LINE_HEIGHT = 46;

/** What the lyric block should look like: every picked line at one flat
 *  weight for the still image, or one line singled out — the way
 *  `.nav-lyric-big[data-state]` singles one out in the lyrics pane — for a
 *  video frame. */
export type FrameLyrics =
  | { mode: "static"; lines: string[] }
  | { mode: "highlight"; lines: string[]; activeIndex: number | null };

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Loads every font weight the card and its video frames draw with, so the
 *  first frame painted never falls back to a system face. */
export function loadStoryFonts(): Promise<FontFace[][]> {
  return Promise.all([
    document.fonts.load('700 52px "Pixelify Sans"'),
    document.fonts.load('700 46px "Pixelify Sans"'),
    document.fonts.load('400 38px "General Sans"'),
    document.fonts.load(LYRIC_FONT),
  ]);
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number
): void {
  ctx.save();
  roundedRectPath(ctx, x, y, size, size, COVER_RADIUS);
  ctx.clip();
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
  ctx.restore();
}

/** Fills the whole canvas with a blocky, pixelated wash of `img`, at the
 *  story card's own size — see `lib/pixelWash.ts` for how the wash itself is
 *  built; the profile banner draws the same wash at a different size. */
function drawPixelatedWash(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  drawWash(ctx, img, WIDTH, HEIGHT, WASH_PIXEL_W, WASH_BLUR_PX);
}

/** Greedy word wrap, capped at `maxLines` — a card is a fixed canvas, not a scroller. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) return lines;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

/** Wraps every picked lyric line, tagging each wrapped row with which picked
 *  line it came from — so a video frame can colour a whole (possibly
 *  multi-row) picked line together, and so the wrap itself, being a pure
 *  function of the same input, comes out identical on every frame. */
function wrapLyricRows(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  maxWidth: number
): { text: string; lineIndex: number }[] {
  const rows: { text: string; lineIndex: number }[] = [];
  lines.forEach((raw, lineIndex) => {
    for (const text of wrapLines(ctx, raw, maxWidth, 2)) {
      rows.push({ text, lineIndex });
    }
  });
  return rows.slice(0, MAX_LYRIC_LINES);
}

/**
 * Paints one full frame of a story card onto `ctx`: background, cover,
 * title/artist, the lyric block described by `lyrics`, and the wordmark.
 * Shared by the still-image path and every frame of a karaoke video.
 */
export function drawStoryFrame(
  ctx: CanvasRenderingContext2D,
  track: Pick<Track, "id" | "title" | "artist" | "has_cover">,
  cover: HTMLImageElement | null,
  lyrics: FrameLyrics
): void {
  ctx.fillStyle = "#030303";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (cover) {
    drawPixelatedWash(ctx, cover);
  }

  const scrim = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  scrim.addColorStop(0, "rgba(3,3,3,.35)");
  scrim.addColorStop(0.55, "rgba(3,3,3,.55)");
  scrim.addColorStop(1, "rgba(3,3,3,.92)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const coverX = (WIDTH - COVER_SIZE) / 2;
  if (cover) {
    drawCoverFit(ctx, cover, coverX, COVER_Y, COVER_SIZE);
  } else {
    ctx.fillStyle = "rgba(255,255,255,.08)";
    roundedRectPath(ctx, coverX, COVER_Y, COVER_SIZE, COVER_SIZE, COVER_RADIUS);
    ctx.fill();
  }

  ctx.textAlign = "center";
  const titleY = COVER_Y + COVER_SIZE + 100;
  ctx.fillStyle = "#f5f5f5";
  ctx.font = '700 52px "Pixelify Sans"';
  ctx.fillText(track.title ?? "Untitled", WIDTH / 2, titleY, WIDTH - 140);

  if (track.artist) {
    ctx.fillStyle = "rgba(245,245,245,.65)";
    ctx.font = '400 38px "General Sans"';
    ctx.fillText(track.artist, WIDTH / 2, titleY + 58, WIDTH - 140);
  }

  if (lyrics.lines.length) {
    ctx.font = LYRIC_FONT;
    const rows = wrapLyricRows(ctx, lyrics.lines, WIDTH - 200);
    let y = titleY + 150;
    for (const row of rows) {
      ctx.fillStyle = lyricColor(lyrics, row.lineIndex);
      ctx.fillText(row.text, WIDTH / 2, y, WIDTH - 200);
      y += LYRIC_LINE_HEIGHT;
    }
  }

  ctx.fillStyle = "rgba(245,245,245,.5)";
  ctx.font = '700 46px "Pixelify Sans"';
  ctx.fillText("NAVAAR", WIDTH / 2, HEIGHT - 170);
}

/** Mirrors `.nav-lyric-big[data-state]`'s palette from index.css: a settled
 *  flat tone for the still image, and past/on/coming for a video frame. */
function lyricColor(lyrics: FrameLyrics, lineIndex: number): string {
  if (lyrics.mode === "static") return "rgba(245,245,245,.78)";
  const { activeIndex } = lyrics;
  if (activeIndex == null || lineIndex > activeIndex) return "rgba(245,245,245,.4)";
  if (lineIndex === activeIndex) return "#ffffff";
  return "rgba(245,245,245,.22)";
}

export async function renderStoryCard(
  track: Pick<Track, "id" | "title" | "artist" | "has_cover">,
  lyricLines: string[]
): Promise<Blob> {
  await loadStoryFonts();

  const cover = track.has_cover ? await loadImage(trackCoverUrl(track.id)) : null;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  drawStoryFrame(ctx, track, cover, { mode: "static", lines: lyricLines });

  return blobFromCanvas(canvas);
}

/**
 * The three Listening Stats share-card templates (Overview, Top Track, Top
 * Artists) — a family with the lyric card above rather than a new design
 * language: same 1080×1920 canvas, same black fill / pixelated wash / scrim
 * background, same Pixelify Sans + General Sans pairing, same wordmark
 * placement.
 */

const STATS_HERO_FONT = '700 128px "Pixelify Sans"';
const STATS_CAPTION_FONT = '400 34px "General Sans"';
const STATS_LINE_FONT = '400 38px "General Sans"';
const STATS_RANK_FONT = '700 40px "Pixelify Sans"';
const ARTIST_ROW_HEIGHT = 132;
const ARTIST_ART_SIZE = 96;

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  return { canvas, ctx };
}

function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render card"))),
      "image/jpeg",
      0.92
    );
  });
}

function drawWordmark(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(245,245,245,.5)";
  ctx.font = '700 46px "Pixelify Sans"';
  ctx.fillText("NAVAAR", WIDTH / 2, HEIGHT - 170);
}

/** Same black-fill / wash / scrim background as `drawStoryFrame`, factored
 *  out so every stats card starts from the same look even with no cover art
 *  to wash (an account with no top track or artist cover still gets a card). */
function drawStatsBackground(ctx: CanvasRenderingContext2D, cover: HTMLImageElement | null): void {
  ctx.fillStyle = "#030303";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (cover) {
    drawPixelatedWash(ctx, cover);
  }

  const scrim = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  scrim.addColorStop(0, "rgba(3,3,3,.4)");
  scrim.addColorStop(0.55, "rgba(3,3,3,.6)");
  scrim.addColorStop(1, "rgba(3,3,3,.94)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function rangeCaption(range: ListeningStatsPage["range"]): string {
  switch (range) {
    case "today":
      return "TODAY";
    case "7d":
      return "THIS WEEK";
    case "30d":
      return "THIS MONTH";
    case "3m":
      return "THESE 3 MONTHS";
    case "1y":
      return "THIS YEAR";
    case "all":
      return "ALL TIME";
  }
}

export async function drawStatsOverviewCard(data: ListeningStatsPage, profileUserId: number): Promise<Blob> {
  await loadStoryFonts();

  const coverId = data.topTracks[0]?.cover_track_id ?? data.topArtists[0]?.cover_track_id ?? null;
  const cover = coverId ? await loadImage(trackCoverUrl(coverId, profileUserId)) : null;

  const { canvas, ctx } = newCanvas();
  drawStatsBackground(ctx, cover);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(245,245,245,.6)";
  ctx.font = STATS_CAPTION_FONT;
  ctx.fillText(`LISTENED ${rangeCaption(data.range)}`, WIDTH / 2, 840);

  ctx.fillStyle = "#f5f5f5";
  ctx.font = STATS_HERO_FONT;
  ctx.fillText(formatListened(data.totalListenedSeconds), WIDTH / 2, 1010, WIDTH - 100);

  ctx.fillStyle = "rgba(245,245,245,.65)";
  ctx.font = STATS_LINE_FONT;
  ctx.fillText(`${data.totalPlays} plays`, WIDTH / 2, 1080);

  const topTrack = data.topTracks[0];
  if (topTrack) {
    ctx.font = STATS_LINE_FONT;
    const rows = wrapLines(ctx, `Most played: ${topTrack.title ?? "Untitled"}`, WIDTH - 200, 2);
    let y = 1620;
    for (const row of rows) {
      ctx.fillStyle = "rgba(245,245,245,.78)";
      ctx.fillText(row, WIDTH / 2, y, WIDTH - 200);
      y += 48;
    }
  }

  drawWordmark(ctx);
  return blobFromCanvas(canvas);
}

export async function drawStatsTopTrackCard(data: ListeningStatsPage, profileUserId: number): Promise<Blob> {
  await loadStoryFonts();

  const track = data.topTracks[0];
  const cover = track?.cover_track_id ? await loadImage(trackCoverUrl(track.cover_track_id, profileUserId)) : null;

  const { canvas, ctx } = newCanvas();
  drawStatsBackground(ctx, cover);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(245,245,245,.6)";
  ctx.font = STATS_CAPTION_FONT;
  ctx.fillText(`TOP TRACK, ${rangeCaption(data.range)}`, WIDTH / 2, COVER_Y - 60);

  const coverX = (WIDTH - COVER_SIZE) / 2;
  if (cover) {
    drawCoverFit(ctx, cover, coverX, COVER_Y, COVER_SIZE);
  } else {
    ctx.fillStyle = "rgba(255,255,255,.08)";
    roundedRectPath(ctx, coverX, COVER_Y, COVER_SIZE, COVER_SIZE, COVER_RADIUS);
    ctx.fill();
  }

  const titleY = COVER_Y + COVER_SIZE + 100;
  ctx.fillStyle = "#f5f5f5";
  ctx.font = '700 52px "Pixelify Sans"';
  ctx.fillText(track?.title ?? "Untitled", WIDTH / 2, titleY, WIDTH - 140);

  if (track?.artist) {
    ctx.fillStyle = "rgba(245,245,245,.65)";
    ctx.font = '400 38px "General Sans"';
    ctx.fillText(track.artist, WIDTH / 2, titleY + 58, WIDTH - 140);
  }

  if (track) {
    ctx.fillStyle = "rgba(245,245,245,.5)";
    ctx.font = STATS_LINE_FONT;
    ctx.fillText(`${track.plays} plays`, WIDTH / 2, titleY + 130);
  }

  drawWordmark(ctx);
  return blobFromCanvas(canvas);
}

export async function drawStatsTopArtistsCard(data: ListeningStatsPage, profileUserId: number): Promise<Blob> {
  await loadStoryFonts();

  const artists = data.topArtists.slice(0, 5);
  const washId = artists.find((a) => a.cover_track_id)?.cover_track_id ?? null;
  const cover = washId ? await loadImage(trackCoverUrl(washId, profileUserId)) : null;

  const { canvas, ctx } = newCanvas();
  drawStatsBackground(ctx, cover);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(245,245,245,.6)";
  ctx.font = STATS_CAPTION_FONT;
  ctx.fillText(`TOP ARTISTS, ${rangeCaption(data.range)}`, WIDTH / 2, 340);

  const listTop = 460;
  const listX = 140;
  const art = await Promise.all(
    artists.map((a) => (a.cover_track_id ? loadImage(trackCoverUrl(a.cover_track_id, profileUserId)) : null))
  );

  ctx.textAlign = "left";
  artists.forEach((a, i) => {
    const rowY = listTop + i * ARTIST_ROW_HEIGHT;

    ctx.fillStyle = "rgba(245,245,245,.5)";
    ctx.font = STATS_RANK_FONT;
    ctx.textAlign = "right";
    ctx.fillText(String(i + 1), listX - 30, rowY + ARTIST_ART_SIZE / 2 + 14);
    ctx.textAlign = "left";

    const img = art[i];
    if (img) {
      drawCoverFit(ctx, img, listX, rowY, ARTIST_ART_SIZE);
    } else {
      ctx.fillStyle = "rgba(255,255,255,.08)";
      roundedRectPath(ctx, listX, rowY, ARTIST_ART_SIZE, ARTIST_ART_SIZE, 16);
      ctx.fill();
    }

    const textX = listX + ARTIST_ART_SIZE + 32;
    ctx.fillStyle = "#f5f5f5";
    ctx.font = '700 44px "Pixelify Sans"';
    const [nameLine] = wrapLines(ctx, a.name, WIDTH - textX - 60, 1);
    ctx.fillText(nameLine ?? a.name, textX, rowY + ARTIST_ART_SIZE / 2 - 6);

    ctx.fillStyle = "rgba(245,245,245,.55)";
    ctx.font = STATS_LINE_FONT;
    ctx.fillText(`${a.plays} plays`, textX, rowY + ARTIST_ART_SIZE / 2 + 38);
  });

  drawWordmark(ctx);
  return blobFromCanvas(canvas);
}
