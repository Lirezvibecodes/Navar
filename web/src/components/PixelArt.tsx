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
      {hasCover ? (
        <img
          src={trackCoverUrl(trackId)}
          alt=""
          loading="lazy"
          decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : null}
    </div>
  );
}

/**
 * The square for a playlist, album or artist: the artwork of a track inside
 * it, or the pattern seeded on the collection's own name.
 */
export function CollectionArt({
  name,
  coverTrackId,
  size,
  radius,
  round,
  /** Fill the column it sits in instead of taking a fixed edge — the grids. */
  fill,
  className,
}: {
  name: string;
  coverTrackId: string | null | undefined;
  size: number;
  radius: number;
  round?: boolean;
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        width: fill ? "100%" : size,
        height: fill ? undefined : size,
        aspectRatio: fill ? "1" : undefined,
        borderRadius: round ? "50%" : radius,
        flex: "none",
        overflow: "hidden",
        ...pixelPattern(name, size),
      }}
    >
      {coverTrackId ? (
        <img
          src={trackCoverUrl(coverTrackId)}
          alt=""
          loading="lazy"
          decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : null}
    </div>
  );
}
