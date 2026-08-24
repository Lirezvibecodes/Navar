import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Navigation } from "../App";
import { TrackRow } from "./TrackRow";
import { TrackMenu } from "./TrackMenu";
import type { TrackMenuTarget } from "./TrackMenu";
import { ActionButton, Empty, GhostButton, Screen, Skeleton } from "./ui";
import { ShuffleIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import type { Track } from "../types";

/**
 * A playlist, an album, an artist, a friend's library: a header and a list.
 *
 * These four screens differ only in what sits at the top and where the rows
 * came from, so they share one body. The Crate is the exception and has its
 * own screen, because selection mode and search belong to it alone.
 */
export function TrackListScreen({
  nav,
  art,
  name,
  subtitle,
  tracks,
  loading = false,
  sourceKey,
  sourceLabel,
  playlistId,
  emptyTitle = "Nothing here yet",
  emptyBody,
  actions,
}: {
  nav: Navigation;
  art: ReactNode;
  name: string;
  subtitle: string;
  tracks: Track[];
  loading?: boolean;
  sourceKey: string;
  sourceLabel: string;
  /** Set when these rows are a playlist, so the menu can remove them from it. */
  playlistId?: string;
  emptyTitle?: string;
  emptyBody?: string;
  /** Extra header controls — rename, visibility, follow. */
  actions?: ReactNode;
}) {
  const { owns, setFavorite } = useLibrary();
  const { current, isPlaying, playFrom, setShuffle } = usePlayer();
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
          style={{ display: "flex", alignItems: "center", gap: 13, paddingTop: 4 }}
        >
          {art}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="nav-clip"
              style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em" }}
            >
              {name}
            </div>
            <div
              style={{ fontSize: 11.5, color: "rgba(255,255,255,.52)", marginTop: 3 }}
            >
              {subtitle}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <ActionButton
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
                onMenu={() => setMenu({ track, playlistId })}
                onToggleFavorite={() =>
                  void setFavorite(track, track.favorited_at == null)
                }
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
