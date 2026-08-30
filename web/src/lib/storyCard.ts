import { trackCoverUrl } from "../api";
import type { Track } from "../types";

/**
 * Renders a track as a Telegram/Instagram story: cover art over a blurred
 * wash of the same image, title and artist, an optional picked lyric line,
 * and the Navaar wordmark. Fixed at the platform's own story aspect (9:16)
 * so it needs no cropping on either end once it lands there.
 */

const WIDTH = 1080;
const HEIGHT = 1920;
const COVER_SIZE = 760;
const COVER_RADIUS = 28;
const COVER_Y = 300;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
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

export async function renderStoryCard(
  track: Pick<Track, "id" | "title" | "artist" | "has_cover">,
  lyricLine: string | null
): Promise<Blob> {
  await Promise.all([
    document.fonts.load('700 34px "Pixelify Sans"'),
    document.fonts.load('600 52px "General Sans"'),
    document.fonts.load('italic 400 34px "General Sans"'),
  ]);

  const cover = track.has_cover ? await loadImage(trackCoverUrl(track.id)) : null;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.fillStyle = "#030303";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (cover) {
    ctx.save();
    ctx.filter = "blur(80px) brightness(.45) saturate(1.3)";
    const scale =
      Math.max(WIDTH / cover.naturalWidth, HEIGHT / cover.naturalHeight) * 1.2;
    const dw = cover.naturalWidth * scale;
    const dh = cover.naturalHeight * scale;
    ctx.drawImage(cover, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh);
    ctx.restore();
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
  ctx.font = '600 52px "General Sans"';
  ctx.fillText(track.title ?? "Untitled", WIDTH / 2, titleY, WIDTH - 140);

  if (track.artist) {
    ctx.fillStyle = "rgba(245,245,245,.65)";
    ctx.font = '400 38px "General Sans"';
    ctx.fillText(track.artist, WIDTH / 2, titleY + 58, WIDTH - 140);
  }

  if (lyricLine) {
    ctx.fillStyle = "rgba(245,245,245,.85)";
    ctx.font = 'italic 400 34px "General Sans"';
    const lines = wrapLines(ctx, `"${lyricLine}"`, WIDTH - 200, 3);
    let y = titleY + 150;
    for (const line of lines) {
      ctx.fillText(line, WIDTH / 2, y, WIDTH - 200);
      y += 46;
    }
  }

  ctx.fillStyle = "rgba(245,245,245,.5)";
  ctx.font = '700 34px "Pixelify Sans"';
  ctx.fillText("NAVAAR", WIDTH / 2, HEIGHT - 120);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render card"))),
      "image/jpeg",
      0.92
    );
  });
}
