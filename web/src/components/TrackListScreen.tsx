import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Navigation } from "../App";
import { TrackRow } from "./TrackRow";
import { TrackMenu } from "./TrackMenu";
import type { TrackMenuTarget } from "./TrackMenu";
import { ActionButton, Empty, GhostButton, Screen, Skeleton } from "./ui";
import { PlayIcon, ShuffleIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import type { Track } from "../types";

/**
 * A playlist, an album, an artist, a friend's library: a header and a list.
 *
 * These four screens differ only in what sits at the top and where the rows
 * came from, so they share one body. The Crate is the exception and has its
 * own screen, because selection mode and search belong to it alone.
 *
 * This header is the only place the collection's name appears. The bar above
 * it carries the KIND — `PLAYLIST`, `ALBUM`, `ARTIST` — because that is the
 * one thing the header cannot tell you: art with a name under it looks the
 * same whoever made it. Printing the name in both places, as this screen used
 * to, spent the top of every detail screen saying one word twice.
 */
export function TrackListScreen({
  nav,
  art,
  name,
  subtitle,
  note,
  tracks,
  loading = false,
  sourceKey,
  sourceLabel,
  playlistId,
  playlistName,
  emptyTitle = "Nothing here yet",
  emptyBody,
  error,
  onRetry,
  actions,
}: {
  nav: Navigation;
  art: ReactNode;
  name: string;
  subtitle: ReactNode;
  /** A line under the header — a playlist owner's description. */
  note?: ReactNode;
  tracks: Track[];
  loading?: boolean;
  sourceKey: string;
  sourceLabel: string;
  /** Set when these rows are a playlist, so the menu can remove them from it. */
  playlistId?: string;
  /** That playlist's name, so the menu's remove item can say which one. */
  playlistName?: string;
  emptyTitle?: string;
  emptyBody?: string;
  /**
   * The fetch failed. An empty list and a failed one look identical from here
   * — both arrive as zero rows — and drawing "Empty playlist. Add some tracks"
   * over a request that timed out is the app lying about the user's own data.
   */
  error?: Error | null;
  onRetry?: () => void;
  /** Extra header controls — rename, visibility, follow. */
  actions?: ReactNode;
}) {
  const { owns, setFavorite } = useLibrary();
  const { current, isPlaying, playFrom, setShuffle, queueNext, queueLast } = usePlayer();
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);

  const source = useMemo(
    () => ({ label: sourceLabel, key: sourceKey, tracks }),
    [sourceLabel, sourceKey, tracks]
  );

  return (
    <>
      <Screen>
        <div
          className="nav-rise"
          style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 4 }}
        >
          {art}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Two lines, then an ellipsis. Now that this is the only place
                the name is written, a long one is allowed to take the room
                it needs instead of being cut at the first line. */}
            <div
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
                fontSize: 19,
                fontWeight: 600,
                lineHeight: 1.2,
                letterSpacing: "-0.02em",
              }}
            >
              {name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--color-nav-muted)",
                marginTop: 5,
              }}
            >
              {subtitle}
            </div>
          </div>
        </div>

        {note}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {/* The hero action of the screen, so it wears the disc. The
              Shuffle beside it stays a ghost - there is one primary here. */}
          <ActionButton
            variant="disc"
            icon={PlayIcon}
            disabled={tracks.length === 0}
            onClick={() => playFrom(source)}
          >
            Play all
          </ActionButton>
          <GhostButton
            icon={ShuffleIcon}
            label="Shuffle"
            width={44}
            onClick={() => {
              if (tracks.length === 0) return;
              setShuffle(true);
              playFrom(source);
            }}
          />
          {actions}
        </div>

        <div style={{ marginTop: 14 }}>
          {loading ? (
            <Skeleton />
          ) : error && tracks.length === 0 ? (
            <Empty
              title="These tracks did not load"
              body="The list is still there. This was the connection, most likely."
              action={onRetry ? "Try again" : undefined}
              onAction={onRetry}
            />
          ) : tracks.length === 0 ? (
            <Empty title={emptyTitle} body={emptyBody} />
          ) : (
            tracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                playing={current?.id === track.id && isPlaying}
                owned={owns(track)}
                favorited={track.favorited_at != null}
                onPlay={() => playFrom(source, track)}
                onMenu={() => setMenu({ track, playlistId, playlistName })}
                onToggleFavorite={() =>
                  void setFavorite(track, track.favorited_at == null)
                }
                onQueueNext={() => queueNext(track)}
                onQueueLast={() => queueLast(track)}
              />
            ))
          )}
        </div>
      </Screen>

      <TrackMenu
        target={menu}
        onClose={() => setMenu(null)}
        onGoTo={(to) => nav.push(to)}
      />
    </>
  );
}
