import { useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Avatar } from "../components/Avatar";
import { CollectionArt } from "../components/PixelArt";
import { Counted, Empty, Screen, Skeleton } from "../components/ui";
import { ChevronRightIcon } from "../icons";
import { useToast } from "../context/ToastContext";
import { personName } from "../lib/format";
import { haptic } from "../telegram";
import type { Person, Playlist } from "../types";

/**
 * What a friend has opened up.
 *
 * Only playlists — a library is not a thing you share, a playlist is. Tapping
 * one opens the ordinary playlist screen, which reads visibility rather than
 * ownership, so the same screen serves both sides of the friendship and the
 * owner-only affordances simply do not render.
 */
export function FriendLibraryView({
  nav,
  friendId,
}: {
  nav: Navigation;
  friendId: number;
}) {
  const { errorToast } = useToast();
  const [person, setPerson] = useState<Person | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([api.listFriends(), api.listUserPlaylists(friendId)])
      .then(([friends, rows]) => {
        if (!live) return;
        setPerson(
          friends.find((f) => Number(f.telegram_user_id) === friendId) ?? null
        );
        setPlaylists(rows);
      })
      .catch((err: unknown) =>
        errorToast(err, "Could not load that library")
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [friendId, errorToast]);

  const handle = person ? personName(person) : "Their Library";

  return (
    <Screen>
      <div
        className="nav-rise"
        style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 4 }}
      >
        <Avatar
          userId={friendId}
          username={person?.handle ?? person?.username}
          hasAvatar={person?.has_avatar ?? false}
          size={56}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="nav-clip"
            style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em" }}
          >
            {handle}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--color-nav-muted)", marginTop: 3 }}>
            <Counted count={playlists.length} one="shared playlist" />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <Skeleton rows={3} />
        ) : playlists.length === 0 ? (
          <Empty
            title="Nothing shared yet"
            body="Playlists show up here once they set one to friends. Nudge them."
          />
        ) : (
          playlists.map((playlist, i) => (
            <button
              key={playlist.id}
              className="nav-press nav-row-in"
              onClick={() => {
                haptic.tap();
                nav.push({ type: "playlist", id: playlist.id, name: playlist.name });
              }}
              style={
                {
                  "--i": i,
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  width: "100%",
                  minHeight: 60,
                  textAlign: "left",
                } as React.CSSProperties
              }
            >
              <CollectionArt
                name={playlist.name}
                coverTrackId={playlist.cover_track_id}
                src={api.playlistArtworkUrl(playlist)}
                size={46}
                radius={10}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  className="nav-clip"
                  style={{ display: "block", fontSize: 13, fontWeight: 600 }}
                >
                  {playlist.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "var(--color-nav-muted)",
                    marginTop: 2,
                  }}
                >
                  <Counted count={playlist.track_count ?? 0} one="track" />
                </span>
              </span>
              <ChevronRightIcon size={15} style={{ color: "var(--color-nav-faint)" }} />
            </button>
          ))
        )}
      </div>
    </Screen>
  );
}
