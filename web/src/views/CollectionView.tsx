import { useEffect, useMemo, useState } from "react";
import type { Navigation } from "../App";
import * as api from "../api";
import { trackCoverUrl } from "../api";
import { CollectionArt } from "../components/PixelArt";
import { TrackListScreen } from "../components/TrackListScreen";
import { useLibrary } from "../context/LibraryContext";
import { Counted, Num } from "../components/ui";
import { CheckIcon } from "../icons";
import { cacheKey, ttl, useCached } from "../lib/cache";
import { splitArtists } from "../lib/artists";
import { formatReleaseDate, trackTitle } from "../lib/format";
import { drawPixelatedWash } from "../lib/pixelWash";
import { loadImage } from "../lib/storyCard";

/**
 * The album header's second line: total tracks and release date, both sourced
 * from MusicBrainz and cached server-side (see `/api/albums/:name/metadata`).
 *
 * `savedCount` (X) is never blocked on this — it's the caller's own live count
 * from `LibraryContext`, rendered as a plain `Counted` line until the request
 * lands, then folded into "X / Y tracks" once it has. A miss or a MusicBrainz
 * failure both come back as `trackCount: null`, which reads as "X / — tracks"
 * rather than as an error.
 */
function AlbumMeta({ name, savedCount }: { name: string; savedCount: number }) {
  const { data } = useCached(
    cacheKey.albumMeta(name),
    () => api.getAlbumMetadata(name),
    ttl.albumMeta
  );
  const trackCount = data?.trackCount ?? null;
  const complete = trackCount != null && savedCount >= trackCount;

  return (
    <>
      <div>
        {data === undefined ? (
          <Counted count={savedCount} one="track" />
        ) : trackCount != null ? (
          <>
            <Num>{savedCount}</Num> / <Num>{trackCount}</Num> tracks
            {complete ? (
              <CheckIcon
                size={12}
                style={{
                  marginLeft: 4,
                  verticalAlign: -1.5,
                  color: "var(--color-nav-action)",
                }}
              />
            ) : null}
          </>
        ) : (
          <>
            <Num>{savedCount}</Num> / — tracks
          </>
        )}
      </div>
      <div style={{ marginTop: 3 }}>
        {data === undefined ? (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 92,
              height: 9,
              borderRadius: 5,
              background: "rgba(255,255,255,.07)",
            }}
          />
        ) : data.releaseDate ? (
          formatReleaseDate(data.releaseDate)
        ) : (
          "Release date unavailable"
        )}
      </div>
    </>
  );
}

/** The story card's own 9:16 proportions, scaled down — this is a fixed
 *  viewport backdrop, not a sharable image, so it only has to be big enough
 *  that `cover`-fit upscaling stays smooth. */
const BACKDROP_W = 480;
const BACKDROP_H = 854;

/**
 * A full-bleed pixelated wash of the album's own cover, recomputed whenever
 * the cover changes — the same technique, and the same default chunkiness,
 * as the story-share background (`lib/pixelWash.ts`). An artist page has no
 * single cover to wash, so this is only ever asked for on an album.
 */
function useAlbumWash(coverUrl: string | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!coverUrl) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const img = await loadImage(coverUrl);
      if (cancelled || !img) return;
      const canvas = document.createElement("canvas");
      canvas.width = BACKDROP_W;
      canvas.height = BACKDROP_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawPixelatedWash(ctx, img, BACKDROP_W, BACKDROP_H);
      if (!cancelled) setDataUrl(canvas.toDataURL("image/jpeg", 0.85));
    })();
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return dataUrl;
}

/**
 * The wash, fixed behind the whole screen the way `CoverBackdrop`'s
 * colour-only wash used to sit for an album (`ui.tsx`'s comment on that
 * component explains the DOM-order stacking this relies on). The scrim
 * carries the same curve as the story card's own (`storyCard.ts`) — light
 * enough near the top that the mosaic still reads as the cover, darkening
 * as it goes — but pushed all the way to a solid `#030303` by the bottom of
 * the viewport rather than stopping at that card's .92, since a page has no
 * edge of its own for the eye to stop the fade at.
 */
function albumBackdropStyle(washUrl: string): React.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    background:
      `linear-gradient(180deg, rgba(3,3,3,.35) 0%, rgba(3,3,3,.55) 55%, ` +
      `rgba(3,3,3,.92) 85%, #030303 100%), url(${washUrl}) center/cover no-repeat`,
  };
}

/**
 * An album or an artist.
 *
 * Both are a GROUP BY over tags rather than a table, so the rows come out of
 * the library already in memory. An album keeps whatever order the tracks were
 * added in — track numbers are not something Telegram gives us — and an artist
 * is sorted by title, because an artist page is a browse, not a running order.
 */
export function CollectionView({
  nav,
  kind,
  name,
}: {
  nav: Navigation;
  kind: "album" | "artist";
  name: string;
}) {
  const { tracks } = useLibrary();

  const rows = useMemo(() => {
    const match = tracks.filter((t) =>
      kind === "album"
        ? t.album === name
        : !!t.artist && splitArtists(t.artist).includes(name)
    );
    if (kind === "artist") {
      match.sort((a, b) => trackTitle(a).localeCompare(trackTitle(b)));
    } else {
      // `tracks` comes back newest-first (see LibraryContext); an album needs
      // the opposite so it reads start-to-end in the order it was built.
      match.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return match;
  }, [tracks, kind, name]);

  const artist =
    kind === "album" ? rows.find((t) => t.artist)?.artist : null;
  const coverTrackId = rows.find((t) => t.has_cover)?.id;

  // Artists have no cover of their own to take a wash from — an album's own
  // tracks all share one sleeve, which is exactly the case the extraction was
  // built for.
  const artUrl = kind === "album" && coverTrackId ? trackCoverUrl(coverTrackId) : null;
  const albumWash = useAlbumWash(artUrl);

  return (
    <>
      {/* An album wears its own cover as the page's own background, so
          there is no square thumbnail competing with it in the header below
          — only an artist, which has no one sleeve to become a backdrop,
          still gets one, in `art` below. */}
      {kind === "album" && albumWash ? (
        <div aria-hidden="true" style={albumBackdropStyle(albumWash)} />
      ) : null}
      <TrackListScreen
        nav={nav}
        art={
          kind === "artist" ? (
            <CollectionArt name={name} coverTrackId={coverTrackId} size={72} radius={36} round />
          ) : undefined
        }
        name={name}
        subtitle={
          kind === "album" ? (
            <>
              {artist ? <div>{artist}</div> : null}
              <AlbumMeta name={name} savedCount={rows.length} />
            </>
          ) : (
            <Counted count={rows.length} one="track" />
          )
        }
        tracks={rows}
        sourceKey={`${kind}:${name}`}
        sourceLabel={name}
        emptyTitle="Nothing under that name"
        emptyBody="The tracks that carried this tag are no longer in your Crate."
      />
    </>
  );
}
