import { useMemo } from "react";
import type { Navigation } from "../App";
import { CollectionArt } from "../components/PixelArt";
import { TrackListScreen } from "../components/TrackListScreen";
import { useLibrary } from "../context/LibraryContext";
import { pluralise, trackTitle } from "../lib/format";

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
      kind === "album" ? t.album === name : t.artist === name
    );
    if (kind === "artist") {
      match.sort((a, b) => trackTitle(a).localeCompare(trackTitle(b)));
    }
    return match;
  }, [tracks, kind, name]);

  const artist =
    kind === "album" ? rows.find((t) => t.artist)?.artist : null;

  return (
    <TrackListScreen
      nav={nav}
      art={
        <CollectionArt
          name={name}
          coverTrackId={rows.find((t) => t.has_cover)?.id}
          size={72}
          radius={kind === "artist" ? 36 : 14}
          round={kind === "artist"}
        />
      }
      name={name}
      subtitle={[artist, pluralise(rows.length, "track")]
        .filter(Boolean)
        .join(" · ")}
      tracks={rows}
      sourceKey={`${kind}:${name}`}
      sourceLabel={name}
      emptyTitle="Nothing under that name"
      emptyBody="The tracks that carried this tag are no longer in your Crate."
    />
  );
}
