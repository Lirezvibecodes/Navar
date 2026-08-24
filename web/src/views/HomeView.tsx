import { useMemo } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Cover, CollectionArt } from "../components/PixelArt";
import { Screen, SectionHeader, Skeleton } from "../components/ui";
import { ArrowRightIcon, PlayIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import { pluralise, trackArtist, trackTitle } from "../lib/format";
import { haptic } from "../telegram";
import type { Playlist } from "../types";

/**
 * The first thing you see.
 *
 * Everything on this screen is either something you were already doing or
 * something the app is asking you to finish. There is no editorial shelf and
 * nothing recommended: Navaar knows only what you forwarded to it.
 *
 * The sections that need somebody else's listening state — Friends listening,
 * From your friends — arrive with the social phase. A section with no data
 * behind it renders nothing rather than an empty frame.
 */
/**
 * The nudge stays quiet until a handful of tracks have piled up. One stray
 * track is not a mess worth a banner.
 */
const UNSORTED_NUDGE_AT = 5;

export function HomeView({ nav }: { nav: Navigation }) {
  const { tracks, playlists, loading } = useLibrary();
  const { current, playFrom } = usePlayer();

  const recent = useMemo(
    () =>
      [...tracks]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 12),
    [tracks]
  );

  const unsorted = useMemo(() => tracks.filter((t) => !t.in_playlist).length, [tracks]);

  // What you were listening to, then what arrived while you were away. Until
  // the plays table exists this is the honest version of "continue listening":
  // the app knows where you stopped and what is new, and nothing else.
  const shelf = useMemo(() => {
    if (!current) return recent;
    return [current, ...recent.filter((t) => t.id !== current.id)];
  }, [current, recent]);

  if (loading) {
    return (
      <Screen>
        <Skeleton />
      </Screen>
    );
  }

  if (tracks.length === 0) return <FirstRun />;

  return (
    <Screen>
      <SectionHeader title="Continue listening" spaceAbove={6} />
      <div className="nav-shelf" style={{ gap: 10 }}>
        {shelf.map((track, i) => (
          <button
            key={track.id}
            className="nav-press nav-row-in"
            onClick={() => {
              haptic.tap();
              playFrom({ label: "Recent", key: "home:recent", tracks: shelf }, track);
            }}
            style={
              {
                "--i": i,
                width: 72,
                flex: "none",
                textAlign: "left",
              } as React.CSSProperties
            }
          >
            <Cover trackId={track.id} hasCover={track.has_cover} size={72} radius={11} />
            <span
              className="nav-clip"
              style={{ display: "block", fontSize: 11, marginTop: 5 }}
            >
              {trackTitle(track)}
            </span>
            <span
              className="nav-clip"
              style={{
                display: "block",
                fontSize: 10.5,
                color: "rgba(255,255,255,.52)",
              }}
            >
              {trackArtist(track)}
            </span>
          </button>
        ))}
      </div>

      {playlists.length > 0 ? (
        <>
          <SectionHeader
            title="Your playlists"
            action="All"
            onAction={() => nav.push({ type: "library" })}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {playlists.slice(0, 2).map((playlist, i) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                tall={i === 0}
                onOpen={() => nav.push({ type: "playlist", id: playlist.id })}
              />
            ))}
          </div>
        </>
      ) : null}

      {unsorted >= UNSORTED_NUDGE_AT ? (
        <button
          className="nav-press nav-rise"
          onClick={() => {
            haptic.tap();
            nav.push({ type: "crate", filter: "unsorted" });
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 31,
            marginTop: 22,
            padding: "0 12px",
            borderRadius: 12,
            background: "rgba(223,252,142,.09)",
            border: "1px solid rgba(223,252,142,.32)",
            color: "#EAF7C9",
            fontSize: 11.5,
          }}
        >
          <span className="nav-clip" style={{ flex: 1, textAlign: "left" }}>
            {pluralise(unsorted, "track")} haven&rsquo;t found a home yet
          </span>
          <ArrowRightIcon size={13} style={{ color: "var(--color-nav-action)" }} />
        </button>
      ) : null}
    </Screen>
  );
}

/** The two cards under the shelf: the first one is tall and carries a Play. */
function PlaylistCard({
  playlist,
  tall,
  onOpen,
}: {
  playlist: Playlist;
  tall: boolean;
  onOpen: () => void;
}) {
  const { playFrom } = usePlayer();

  return (
    <div
      className="nav-card nav-rise"
      style={{
        position: "relative",
        height: tall ? 214 : 150,
        borderRadius: 14,
        padding: "11px 12px",
        overflow: "hidden",
      }}
    >
      <button
        className="nav-press"
        onClick={() => {
          haptic.tap();
          onOpen();
        }}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "flex-end",
          padding: "11px 12px",
          textAlign: "left",
        }}
      >
        <CollectionArt
          name={playlist.name}
          coverTrackId={playlist.cover_track_id}
          size={tall ? 120 : 90}
          radius={12}
          className="nav-card-art"
        />
      </button>

      <div
        style={{
          position: "absolute",
          left: 12,
          top: 11,
          right: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          pointerEvents: "none",
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            className="nav-clip"
            style={{ display: "block", fontSize: 14.5, fontWeight: 600 }}
          >
            {playlist.name}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,.52)" }}>
            {pluralise(playlist.track_count ?? 0, "track")}
          </span>
        </span>
        {tall ? (
          <button
            className="nav-press"
            aria-label={`Play ${playlist.name}`}
            onClick={() => {
              haptic.press();
              void api.listPlaylistTracks(playlist.id).then((rows) =>
                playFrom({
                  label: playlist.name,
                  key: `playlist:${playlist.id}`,
                  tracks: rows,
                })
              );
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 13px",
              borderRadius: 15,
              flex: "none",
              pointerEvents: "auto",
              background: "var(--color-nav-action)",
              color: "#0A0A0A",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <PlayIcon size={12} />
            Play
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Screen 3c. Nothing else renders until there is something to put in it —
 * a library screen with a skeleton and a search bar and no music is a shop
 * window with nothing behind the glass.
 */
function FirstRun() {
  return (
    <Screen>
      <div
        className="nav-rise"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "48px 16px 0",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 18,
            background: "linear-gradient(150deg,#DFFC8E,#89AEFF)",
          }}
        />
        <h2 className="nav-display" style={{ margin: "14px 0 0", fontSize: 20 }}>
          Your first track
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "rgba(255,255,255,.62)",
            maxWidth: 280,
          }}
        >
          Forward any audio file to the bot. It lands here, tagged and playable.
        </p>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 11.5,
            lineHeight: 1.6,
            color: "rgba(255,255,255,.42)",
            maxWidth: 280,
          }}
        >
          Long-press a track in any chat → Forward → @navaar_bot
        </p>
      </div>
    </Screen>
  );
}
