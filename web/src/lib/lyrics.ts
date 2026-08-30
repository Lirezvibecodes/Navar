/**
 * Lyrics come in as one blob of text and can be either of two things: an LRC
 * file with a timestamp on every line, or somebody's plain paste. There is no
 * flag to tell them apart, so the parser decides by looking — if timestamps
 * are there, the pane scrolls itself; if they are not, it is a page of text.
 *
 * Anything half-tagged is treated as plain. A file where only the chorus
 * carries times would otherwise scroll to the chorus and sit there, which
 * reads as a bug rather than as a partial file.
 */

export interface LyricLine {
  /** Seconds into the track, or null in a plain file. */
  at: number | null;
  text: string;
}

export interface Lyrics {
  kind: "timed" | "plain";
  lines: LyricLine[];
}

// [mm:ss.xx] or [mm:ss], repeated when one line carries several timestamps.
const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLyrics(raw: string | null | undefined): Lyrics | null {
  const text = raw?.trim();
  if (!text) return null;

  const source = text.split(/\r?\n/);
  const timed: LyricLine[] = [];
  let plainCount = 0;

  for (const line of source) {
    STAMP.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = STAMP.exec(line)) != null) {
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      stamps.push(Number(match[1]) * 60 + Number(match[2]) + fraction);
    }

    const body = line.replace(STAMP, "").trim();
    if (stamps.length === 0) {
      // Blank lines are spacing in a plain file and noise in a timed one.
      if (body) plainCount++;
      continue;
    }
    for (const at of stamps) timed.push({ at, text: body });
  }

  // A file is timed only if essentially all of it is.
  if (timed.length > 0 && timed.length >= plainCount * 4) {
    timed.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    return { kind: "timed", lines: timed };
  }

  return {
    kind: "plain",
    lines: source.map((text) => ({ at: null, text: text.trim() })),
  };
}

/**
 * Which line is being sung at this position. Returns -1 before the first
 * timestamp, which is the ordinary state during an intro.
 */
export function activeLineAt(lines: LyricLine[], position: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].at ?? 0) <= position) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * How many seconds of silence come before line `i` — the distance from the
 * previous line's timestamp to this one's, and from zero for the first line,
 * which is the intro.
 *
 * The pane uses it to find the instrumental breaks: line-level timings are all
 * LRCLIB gives us, but a gap between two of them is a real, derivable fact
 * about the song, and it is the difference between a screen that has stopped
 * and a screen that is waiting.
 */
export function gapBefore(lines: LyricLine[], i: number): number {
  const at = lines[i]?.at;
  if (at == null) return 0;
  const before = i === 0 ? 0 : (lines[i - 1]?.at ?? 0);
  return at - before;
}
