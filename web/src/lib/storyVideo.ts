import * as api from "../api";
import { shareToStory } from "../telegram";
import type { Track } from "../types";
import {
  drawStoryFrame,
  loadImage,
  loadStoryFonts,
  STORY_HEIGHT,
  STORY_WIDTH,
  type FrameLyrics,
} from "./storyCard";

/**
 * The karaoke video story: the same card as the still image, but ten
 * seconds of it, with a picked passage highlighting line by line in sync
 * with the timestamps LRCLIB gave those lines — over the track's own audio.
 * The client only ever draws still frames and says how long each one holds;
 * the server (`ffmpeg.ts`) is what actually turns that into a video, since
 * that's also where the real audio already lives.
 */

const CLIP_SECONDS = 10;
/** Room to sit on the last picked line before the clip ends. */
const TAIL_SECONDS = 1.5;

export interface HighlightSegment {
  /** Index into the picked lines, or null for a lead-in with nothing active yet. */
  activeIndex: number | null;
  /** Seconds into the clip, not the track. */
  start: number;
  end: number;
}

export interface HighlightWindow {
  clipStart: number;
  clipDuration: number;
  segments: HighlightSegment[];
}

/**
 * Where in the track the clip should sit, and when each picked line should
 * light up within it. A pick with no real timestamps (a plain-text lyric
 * file, or "Skip") falls back to a flat ten seconds from the top of the
 * track, with nothing to highlight.
 */
export function buildHighlightWindow(
  lines: { text: string; at: number | null }[],
  trackDuration: number
): HighlightWindow {
  const timed = lines
    .map((line, i) => ({ i, at: line.at }))
    .filter((line): line is { i: number; at: number } => line.at != null);

  if (timed.length === 0) {
    const clipDuration =
      trackDuration > 0 ? Math.min(CLIP_SECONDS, trackDuration) : CLIP_SECONDS;
    return { clipStart: 0, clipDuration, segments: [] };
  }

  const first = timed[0].at;
  const last = timed[timed.length - 1].at;
  const span = last - first;

  let clipStart: number;
  let clipDuration: number;
  if (span >= CLIP_SECONDS) {
    clipStart = first;
    clipDuration = span + TAIL_SECONDS;
  } else {
    clipStart = first - (CLIP_SECONDS - span) / 2;
    clipDuration = CLIP_SECONDS;
  }

  clipStart = Math.max(0, clipStart);
  if (trackDuration > 0) {
    clipDuration = Math.min(clipDuration, trackDuration - clipStart);
    clipStart = Math.max(0, Math.min(clipStart, trackDuration - clipDuration));
  }

  const segments: HighlightSegment[] = timed.map(({ i, at }, idx) => {
    const start = Math.max(0, at - clipStart);
    const next = timed[idx + 1];
    const end = next ? Math.max(start, next.at - clipStart) : clipDuration;
    return { activeIndex: i, start, end };
  });

  // A gap before the first picked line plays: nothing highlighted yet.
  if (segments[0].start > 0.05) {
    segments.unshift({ activeIndex: null, start: 0, end: segments[0].start });
  }

  return { clipStart, clipDuration, segments };
}

/** One rendered frame per highlight change, each carrying how long (in
 *  seconds) it should hold the screen — a handful of frames for a typical
 *  pick, not hundreds. */
export async function renderStoryVideoFrames(
  track: Pick<Track, "id" | "title" | "artist" | "has_cover">,
  lines: { text: string }[],
  window: HighlightWindow
): Promise<{ frames: Blob[]; durations: number[] }> {
  await loadStoryFonts();
  const cover = track.has_cover ? await loadImage(api.trackCoverUrl(track.id)) : null;
  const texts = lines.map((l) => l.text);

  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const toBlob = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not render frame"))),
        "image/jpeg",
        0.9
      );
    });

  const segments = window.segments.length
    ? window.segments
    : [{ activeIndex: null, start: 0, end: window.clipDuration }];

  const frames: Blob[] = [];
  const durations: number[] = [];
  for (const segment of segments) {
    const lyrics: FrameLyrics = texts.length
      ? { mode: "highlight", lines: texts, activeIndex: segment.activeIndex }
      : { mode: "highlight", lines: [], activeIndex: null };
    drawStoryFrame(ctx, track, cover, lyrics);
    frames.push(await toBlob());
    durations.push(Math.max(0.1, segment.end - segment.start));
  }

  return { frames, durations };
}

/** Renders, uploads and hands off a karaoke story video — the video twin of
 *  `TrackMenu.tsx`'s `shareStory` for the still image. */
export async function shareStoryVideo(
  track: Track,
  lines: { text: string; at: number | null }[]
): Promise<boolean> {
  const window = buildHighlightWindow(lines, track.duration_seconds ?? 0);
  const { frames, durations } = await renderStoryVideoFrames(track, lines, window);
  const { url } = await api.uploadStoryVideo(
    track.id,
    frames,
    durations,
    window.clipStart,
    window.clipDuration
  );
  return shareToStory(url);
}
