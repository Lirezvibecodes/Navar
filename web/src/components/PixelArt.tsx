import { trackCoverUrl } from "../api";

/**
 * Artwork, real or generated.
 *
 * Most tracks arrive from Telegram with no album art, and a library of grey
 * squares reads as broken rather than as empty. The fallback is the pixel
 * pattern from the design system: a repeating four-colour conic tile, sized to
 * the thing it fills and picked deterministically from the track id, so the
 * same track is the same square everywhere it appears in the app.
 */

const VARIANTS = [
  ["#89AEFF", "#BCE4FE", "#DFFC8E", "#141414"],
  ["#DFFC8E", "#141414", "#89AEFF", "#BCE4FE"],
  ["#E0389B", "#1A1A1A", "#BCE4FE", "#89AEFF"],
  ["#BCE4FE", "#DFFC8E", "#1F1F1F", "#E0389B"],
];

function variantFor(seed: string): string[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return VARIANTS[Math.abs(hash) % VARIANTS.length];
}

/**
 * How big one tile of the pattern is. The steps are taken from the wireframe,
 * where the pattern deliberately does not scale with the artwork: a 40px row
 * thumbnail shows a coarse grid and a 196px hero shows a slightly finer one,
 * so the texture reads as pixels rather than as a zoomed image.
 */
function cellSize(size: number): number {
  if (size <= 34) return 7;
  if (size <= 56) return 8;
  if (size <= 70) return 9;
  if (size <= 120) return 10;
  if (size <= 160) return 11;
  return 14;
}

export function pixelPattern(seed: string, size: number): React.CSSProperties {
  const [a, b, c, d] = variantFor(seed);
  const cell = cellSize(size);
  return {
    backgroundImage: `conic-gradient(${a} 0 25%, ${b} 0 50%, ${c} 0 75%, ${d} 0)`,
    backgroundSize: `${cell}px ${cell}px`,
  };
}

interface CoverProps {
  trackId: string;
  hasCover: boolean;
  size: number;
  radius: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Cover({
  trackId,
  hasCover,
  size,
  radius,
  className,
  style,
}: CoverProps) {
  const base: React.CSSProperties = {
    position: "relative",
    width: size,
    height: size,
    borderRadius: radius,
    flex: "none",
    overflow: "hidden",
    ...pixelPattern(trackId, size),
    ...style,
  };

  // The pattern stays underneath rather than being swapped out, so a cover
  // that is still loading — or that 404s because the bytes went missing —
  // shows the generated square instead of a hole.
  return (
    <div className={className} style={base}>
      {hasCover ? <ArtImage src={trackCoverUrl(trackId)} /> : null}
    </div>
  );
}

/**
 * The square for a playlist, album or artist: an image of its own if it has
 * one, else the artwork of a track inside it, else the pattern seeded on the
 * collection's own name.
 */
export function CollectionArt({
  name,
  coverTrackId,
  /** A picture belonging to the collection itself. Wins over coverTrackId. */
  src,
  size,
  radius,
  round,
  /** Fill the column it sits in instead of taking a fixed edge — the grids. */
  fill,
  className,
}: {
  name: string;
  coverTrackId: string | null | undefined;
  src?: string | null;
  size: number;
  radius: number;
  round?: boolean;
  fill?: boolean;
  className?: string;
}) {
  const art = src ?? (coverTrackId ? trackCoverUrl(coverTrackId) : null);
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: fill ? "100%" : size,
        // height: 0 with a 100% bottom padding, not aspect-ratio. A percentage
        // padding always resolves against the width, on every WebView Telegram
        // ships on and whatever the contents turn out to be, so a row of tiles
        // cannot come out at three different heights.
        height: fill ? 0 : size,
        paddingBottom: fill ? "100%" : undefined,
        borderRadius: round ? "50%" : radius,
        flex: "none",
        overflow: "hidden",
        ...pixelPattern(name, size),
      }}
    >
      {art ? <ArtImage src={art} /> : null}
    </div>
  );
}

/**
 * The artwork itself, pinned to its box rather than laid out inside it.
 *
 * A `width: 100%; height: 100%` image only fills its parent while the parent
 * has a height the percentage can resolve against. In a grid tile the height is
 * derived rather than declared, and when the percentage falls back to `auto`
 * the image renders at its natural size — a 1400px cover inside a 112px tile,
 * cropped to its top-left corner and shoving everything around it out of the
 * way. Taking it out of flow makes that impossible: the box decides the size,
 * always, and object-fit does the cropping.
 */
function ArtImage({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
      }}
    />
  );
}
