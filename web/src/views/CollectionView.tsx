import { useMemo } from "react";
import type { Navigation } from "../App";
import { trackCoverUrl } from "../api";
import { CollectionArt } from "../components/PixelArt";
import { TrackListScreen } from "../components/TrackListScreen";
import { useLibrary } from "../context/LibraryContext";
import { Counted, CoverBackdrop } from "../components/ui";
import { splitArtists } from "../lib/artists";
import { trackTitle } from "../lib/format";
import { usePaletteForUrl } from "../lib/palette";

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
  const palette = usePaletteForUrl(artUrl, `album:${name}`);

  return (
    <>
      <CoverBackdrop palette={palette} />
      <TrackListScreen
        nav={nav}
        art={
          <CollectionArt
            name={name}
            coverTrackId={coverTrackId}
            size={72}
            radius={kind === "artist" ? 36 : 14}
            round={kind === "artist"}
          />
        }
        name={name}
        subtitle={
          <>
            {artist ? <>{artist}{" · "}</> : null}
            <Counted count={rows.length} one="track" />
          </>
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
