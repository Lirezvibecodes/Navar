import { cached, cacheKey, peek, ttl } from "./cache";
import { trackCoverUrl } from "../api";

/**
 * The player's backdrop, taken from the cover art.
 *
 * The extracted *hue* is the only thing that survives extraction. Lightness and
 * saturation are re-emitted inside a fixed dark band, so a white sleeve and a
 * neon one land in the same darkness and differ only in tint. On top of that
 * the contrast of white text against the composited stop is measured and the
 * stop darkened until it clears 7:1, and a fixed scrim covers the lower half of
 * the screen where the title, artist and controls actually sit. Three
 * independent guarantees: no cover can produce unreadable text, including one
 * that defeats the first two.
 *
 * Anything that goes wrong — a cover that will not load, a canvas the browser
 * refuses to read back, a sleeve with no colour in it at all — returns null and
 * the player renders exactly what it rendered before this file existed.
 */

/** The band every stop is re-emitted into, whatever the cover's own lightness. */
const L_MIN = 0.12;
const L_MAX = 0.22;
/** Saturation ceiling. Above this a tint stops reading as a tint. */
const S_MAX = 0.55;
/** White on the backdrop must clear this. AAA for body text is 7:1. */
const MIN_CONTRAST = 7;
/** A cover that has not loaded by now is not going to decide the backdrop. */
const LOAD_TIMEOUT_MS = 4000;
/**
 * Alphas the two stops are painted at. Declared here rather than written into
 * the gradient string, because the contrast check has to composite the exact
 * colour the eye will see — if these two drifted apart the guarantee would be
 * measuring a colour that is never painted.
 */
const HI_ALPHA = 0.92;
const LO_ALPHA = 0.55;
/** What the stops are painted over. Matches the player's own background. */
const BASE: Rgb = [3, 3, 3];

type Rgb = [number, number, number];

export interface Palette {
  /** Centre of the wash, already darkened past the contrast floor. */
  hi: Rgb;
  /** Its outer edge — the second hue of the cover, or the first, dimmed. */
  lo: Rgb;
}

/** Today's look, kept exact so a cover that yields nothing changes nothing. */
const STATIC_GLOW =
  "radial-gradient(60% 78% at 50% 46%,rgba(137,174,255,.13),rgba(223,252,142,.05) 46%,transparent 72%)";

/**
 * The scrim. Fixed, not derived: it is the guarantee that holds when the other
 * two are argued with, so it does not get a vote from the artwork.
 */
const SCRIM =
  "linear-gradient(to bottom, transparent 40%, rgba(3,3,3,.85) 78%, #030303)";

// --- Colour ----------------------------------------------------------------

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      : max === gn
        ? ((bn - rn) / d + 2) / 6
        : ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let v = t;
    if (v < 0) v += 1;
    if (v > 1) v -= 1;
    if (v < 1 / 6) return p + (q - p) * 6 * v;
    if (v < 1 / 2) return q;
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
    return p;
  };
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number): number => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastWithWhite(rgb: Rgb): number {
  return 1.05 / (luminance(rgb) + 0.05);
}

function composite(rgb: Rgb, alpha: number): Rgb {
  return rgb.map((v, i) => Math.round(v * alpha + BASE[i] * (1 - alpha))) as Rgb;
}

/**
 * Emits a hue at a lightness the text can survive: inside the band first, then
 * stepped down further for as long as white still fails against the colour that
 * will actually be painted. A hue the eye reads as bright — yellow, cyan —
 * needs more of this than a blue does, which is the whole reason the check is
 * on measured luminance rather than on the L we asked for.
 */
function darken(h: number, s: number, l: number, alpha: number): Rgb {
  const capped = Math.min(s, S_MAX);
  let level = Math.min(Math.max(l, L_MIN), L_MAX);
  let rgb = hslToRgb(h, capped, level);
  while (contrastWithWhite(composite(rgb, alpha)) < MIN_CONTRAST && level > 0.04) {
    level -= 0.01;
    rgb = hslToRgb(h, capped, level);
  }
  return rgb;
}

// --- Extraction ------------------------------------------------------------

function loadCover(trackId: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Deliberately no crossOrigin. Covers are served by this same origin with
    // the token in the query string, so the canvas does not taint; asking for
    // CORS would turn a working same-origin load into a preflight the cover
    // route does not answer.
    const timer = setTimeout(() => {
      resolve(null);
    }, LOAD_TIMEOUT_MS);
    const settle = (value: HTMLImageElement | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    img.onload = () => {
      settle(img);
    };
    img.onerror = () => {
      settle(null);
    };
    img.src = trackCoverUrl(trackId);
  });
}

/**
 * 16x16 is not a compromise. The backdrop is two colours behind a scrim, so the
 * question being asked of the artwork is "roughly what colour is this", and
 * letting the GPU box-filter a 600px sleeve down to 256 pixels answers it more
 * cheaply — and more stably — than walking the full bitmap would.
 */
const GRID = 16;
/**
 * 30 degrees per bucket: enough to tell a cover's colours apart, coarse enough
 * that gradient and noise inside one sleeve do not split into several.
 */
const BUCKETS = 12;

interface Bucket {
  weight: number;
  hue: number;
  saturation: number;
  lightness: number;
}

function readPixels(img: HTMLImageElement): Uint8ClampedArray | null {
  const canvas = document.createElement("canvas");
  canvas.width = GRID;
  canvas.height = GRID;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, GRID, GRID);
    return ctx.getImageData(0, 0, GRID, GRID).data;
  } catch {
    // A tainted canvas throws here rather than returning anything readable.
    return null;
  }
}

function bucketsOf(pixels: Uint8ClampedArray): Bucket[] {
  const buckets: Bucket[] = Array.from({ length: BUCKETS }, () => ({
    weight: 0,
    hue: 0,
    saturation: 0,
    lightness: 0,
  }));

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const [h, s, l] = rgbToHsl([pixels[i], pixels[i + 1], pixels[i + 2]]);
    // Weighted by saturation, so the grey in a sleeve does not outvote the one
    // colour in it, and by distance from both extremes, so a blown-out white
    // border and a black one contribute nearly nothing.
    const weight = s * (1 - Math.abs(l - 0.5) * 1.6);
    if (weight <= 0) continue;

    const bucket = buckets[Math.min(BUCKETS - 1, Math.floor(h * BUCKETS))];
    bucket.weight += weight;
    bucket.hue += h * weight;
    bucket.saturation += s * weight;
    bucket.lightness += l * weight;
  }

  return buckets
    .filter((b) => b.weight > 0)
    .map((b) => ({
      weight: b.weight,
      hue: b.hue / b.weight,
      saturation: b.saturation / b.weight,
      lightness: b.lightness / b.weight,
    }))
    .sort((a, b) => b.weight - a.weight);
}

async function extract(trackId: string): Promise<Palette | null> {
  const img = await loadCover(trackId);
  if (!img) return null;

  const pixels = readPixels(img);
  if (!pixels) return null;

  const ranked = bucketsOf(pixels);
  // Nothing colourful enough to tint with — a black-and-white sleeve, or a
  // cover that decoded to nothing. Today's look is the better answer than a
  // grey wash that looks like a rendering fault.
  if (ranked.length === 0) return null;

  const first = ranked[0];
  const second = ranked[1] ?? first;
  return {
    hi: darken(first.hue, first.saturation, first.lightness, HI_ALPHA),
    lo: darken(second.hue, second.saturation, second.lightness, LO_ALPHA),
  };
}

/**
 * Colours never change for a track, so this is cached for the session and a
 * track already played comes back with its backdrop on the first frame. A cover
 * that failed caches its null too: it is the same cover, and asking the network
 * again on every replay would cost more than the tint is worth.
 */
export function paletteFor(
  trackId: string,
  hasCover: boolean
): Promise<Palette | null> {
  if (!hasCover) return Promise.resolve(null);
  return cached(cacheKey.palette(trackId), () => extract(trackId), ttl.palette);
}

/**
 * The answer if it is already known, without waiting a frame for it. Undefined
 * means this cover has not been looked at yet, which is not the same as having
 * been looked at and yielded nothing.
 */
export function peekPalette(trackId: string): Palette | null | undefined {
  return peek<Palette | null>(cacheKey.palette(trackId));
}

// --- CSS -------------------------------------------------------------------

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * The full-bleed wash behind the whole player, scrim on top. Null when there is
 * no palette: the player keeps its flat background and nothing is painted.
 */
export function backdropCss(palette: Palette | null): string | undefined {
  if (!palette) return undefined;
  return [
    SCRIM,
    `radial-gradient(120% 62% at 50% 16%,${rgba(palette.hi, HI_ALPHA)},${rgba(palette.lo, LO_ALPHA)} 48%,transparent 76%)`,
  ].join(",");
}

/**
 * The glow immediately around the artwork. Same geometry and same alphas as it
 * has always had; only the two colours move, and with no palette it is today's
 * string exactly.
 */
export function artGlowCss(palette: Palette | null): string {
  if (!palette) return STATIC_GLOW;
  return `radial-gradient(60% 78% at 50% 46%,${rgba(palette.hi, 0.13)},${rgba(palette.lo, 0.05)} 46%,transparent 72%)`;
}
