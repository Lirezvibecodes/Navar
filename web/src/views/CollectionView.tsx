import { useEffect, useMemo, useState } from "react";
import type { Navigation } from "../App";
import * as api from "../api";
import { trackCoverUrl } from "../api";
import { CollectionArt } from "../components/PixelArt";
import { MissingTracksSheet } from "../components/MissingTracksSheet";
import { TrackListScreen } from "../components/TrackListScreen";
import { albumArtistOf, useLibrary } from "../context/LibraryContext";
import { Counted, Num } from "../components/ui";
import { CheckIcon, ChevronRightIcon } from "../icons";
import { cacheKey, ttl, useCached } from "../lib/cache";
import { splitArtists } from "../lib/artists";
import { matchAlbumTracklist } from "../lib/albumTracklist";
import { formatReleaseDate, trackTitle } from "../lib/format";
import { drawPixelatedWash } from "../lib/pixelWash";
import { loadImage } from "../lib/storyCard";
import { haptic } from "../telegram";

/**
 * The album header's second line: total tracks and release date, both sourced
 * from MusicBrainz and cached server-side (see `/api/albums/:name/metadata`).
 *
 * `savedCount` (X) is never blocked on this — it's the caller's own live count
 * from `LibraryContext`, rendered as a plain `Counted` line until the request
 * lands, then folded into "X / Y tracks" once it has. A miss or a MusicBrainz
 * failure both come back as `trackCount: null`, which reads as "X / — tracks"
 * rather than as an error.
 *
 * `onOpenMissing` is only ever passed once the release's tracklist is known
 * and at least one of its tracks isn't in the Crate yet — a complete album
 * has nothing to show in that sheet, so the line stays plain text for it.
 */
function AlbumMeta({
  data,
  savedCount,
  onOpenMissing,
}: {
  data: api.AlbumMetadata | undefined;
  savedCount: number;
  onOpenMissing?: () => void;
}) {
  const trackCount = data?.trackCount ?? null;
  const complete = trackCount != null && savedCount >= trackCount;

  // A miss (data resolved but trackCount stayed null) reads exactly like the
  // still-loading state — a plain count — rather than as "10 / — tracks",
  // since there's nothing meaningful to put after the slash.
  const countLine =
    data !== undefined && trackCount != null ? (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <Num>{savedCount}</Num> / <Num>{trackCount}</Num> tracks
        {complete ? (
          <CheckIcon
            size={12}
            style={{
              marginLeft: 4,
              flex: "none",
              color: "var(--color-nav-action)",
            }}
          />
        ) : null}
      </span>
    ) : (
      <Counted count={savedCount} one="track" />
    );

  return (
    <>
      <div>
        {onOpenMissing ? (
          <button
            className="nav-press"
            onClick={() => {
              haptic.tap();
              onOpenMissing();
            }}
            style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
          >
            {countLine}
            <ChevronRightIcon size={11} style={{ opacity: 0.4, flex: "none" }} />
          </button>
        ) : (
          countLine
        )}
      </div>
      {data === undefined ? (
        <div style={{ marginTop: 3 }}>
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
        </div>
      ) : data.releaseDate ? (
        <div style={{ marginTop: 3 }}>{formatReleaseDate(data.releaseDate)}</div>
      ) : null}
    </>
  );
}

/** The wash only ever shows behind the header band now (see
 *  `albumBackdropStyle`), not the full page, so its own target is a squarer
 *  crop rather than a tall 9:16 page — closer to the cover's own shape means
 *  the pixelation's cover-fit crop (`pixelWash.ts`) chops far less of the
 *  sleeve away, instead of the zoomed-in sliver a portrait target produced. */
const BACKDROP_W = 480;
const BACKDROP_H = 400;

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
 * The wash sits fixed behind the whole screen the way `CoverBackdrop`'s
 * colour-only wash used to for an album (`ui.tsx`'s comment on that
 * component explains the DOM-order stacking this relies on) — but the photo
 * itself (the second `backgroundSize`/`backgroundPosition` layer) is only
 * ever drawn across roughly the top two-fifths of the viewport, the same "a
 * third of the screen, or a bit more" band the header sits in. The scrim
 * above it starts dark enough on its own not to fight the header text, and
 * reaches the app's own flat background (`--color-nav-bg`) a little past the
 * one-third mark — well before the photo layer's own lower edge — so
 * everything below that is plain background, not a fading image.
 */
function albumBackdropStyle(washUrl: string): React.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    backgroundImage:
      `linear-gradient(180deg, rgba(3,3,3,.55) 0%, rgba(3,3,3,.78) 20%, ` +
      `rgba(3,3,3,.95) 32%, var(--color-nav-bg) 40%, var(--color-nav-bg) 100%), ` +
      `url(${washUrl})`,
    backgroundSize: "100% 100%, 100% 46%",
    backgroundPosition: "0 0, top center",
    backgroundRepeat: "no-repeat, no-repeat",
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
  const [missingOpen, setMissingOpen] = useState(false);

  // Only an album carries release metadata — an artist page fetches nothing,
  // so its key and fetcher stay fixed no matter which artist is open.
  const { data: albumMeta } = useCached<api.AlbumMetadata | null>(
    kind === "album" ? cacheKey.albumMeta(name) : "album-meta:none",
    () => (kind === "album" ? api.getAlbumMetadata(name) : Promise.resolve(null)),
    ttl.albumMeta
  );

  const filtered = useMemo(
    () =>
      tracks.filter((t) =>
        kind === "album"
          ? t.album === name
          : !!t.artist && splitArtists(t.artist).includes(name)
      ),
    [tracks, kind, name]
  );

  // Lines the album up against the release's own tracklist, once MusicBrainz
  // has one — this is what both the "X / Y tracks" chevron and the row order
  // below draw from, so the two can never disagree about what's missing.
  const tracklistMatch = useMemo(() => {
    if (kind !== "album" || !albumMeta?.tracklist || albumMeta.tracklist.length === 0) {
      return null;
    }
    return matchAlbumTracklist(filtered, albumMeta.tracklist);
  }, [kind, albumMeta, filtered]);

  const rows = useMemo(() => {
    if (kind === "artist") {
      return [...filtered].sort((a, b) => trackTitle(a).localeCompare(trackTitle(b)));
    }
    if (tracklistMatch) return tracklistMatch.ordered;
    // No authentic order available (no MusicBrainz match, or a tracklist
    // that hasn't resolved yet) — fall back to upload order. `tracks` comes
    // back newest-first (see LibraryContext); an album needs the opposite so
    // it reads start-to-end in the order it was built.
    return [...filtered].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [kind, filtered, tracklistMatch]);

  const hasMissingTracks =
    !!tracklistMatch && tracklistMatch.matched.some((entry) => !entry.track);

  // The header credits the album to whichever artist tags every track
  // agrees on, same as the Library grid — a track tagged "Drake feat. Travis
  // Scott" doesn't get its feature printed into the album's own byline unless
  // every other track carries it too.
  const artist = kind === "album" ? albumArtistOf(rows) : null;
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
              <AlbumMeta
                data={albumMeta ?? undefined}
                savedCount={rows.length}
                onOpenMissing={hasMissingTracks ? () => setMissingOpen(true) : undefined}
              />
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
      {kind === "album" && tracklistMatch ? (
        <MissingTracksSheet
          open={missingOpen}
          onClose={() => setMissingOpen(false)}
          albumName={name}
          matched={tracklistMatch.matched}
        />
      ) : null}
    </>
  );
}
