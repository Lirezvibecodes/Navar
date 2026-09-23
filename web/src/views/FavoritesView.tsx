import { useMemo } from "react";
import type { Navigation } from "../App";
import { CollectionArt } from "../components/PixelArt";
import { TrackListScreen } from "../components/TrackListScreen";
import { useLibrary } from "../context/LibraryContext";
import { useFavoritesArt } from "../lib/favoritesArt";
import { pluralise } from "../lib/format";

/**
 * Every track you have hearted, shown as a playlist rather than a filter.
 *
 * It has no row of its own in the database — favoriting a track just sets
 * `favorited_at` on a track you already own — so there is nothing here to
 * add to, remove from, share or make public by hand. The heart on a row,
 * wired up by TrackListScreen itself, is the only way anything joins or
 * leaves this list, and it updates live because this screen reads the same
 * tracks LibraryContext already holds.
 */
export function FavoritesView({ nav }: { nav: Navigation }) {
  const { tracks, me, loading } = useLibrary();
  const art = useFavoritesArt(me?.id ?? null);

  const favorites = useMemo(
    () =>
      tracks
        .filter((t) => t.favorited_at != null)
        .sort((a, b) => (b.favorited_at ?? "").localeCompare(a.favorited_at ?? "")),
    [tracks]
  );

  return (
    <TrackListScreen
      nav={nav}
      art={<CollectionArt name="Favourites" coverTrackId={null} src={art} size={96} radius={16} />}
      name="Favourites"
      subtitle={pluralise(favorites.length, "track")}
      tracks={favorites}
      loading={loading}
      sourceKey="favorites"
      sourceLabel="Favourites"
      emptyTitle="No favourites yet"
      emptyBody="Tap the heart on any track and it turns up here."
    />
  );
}
