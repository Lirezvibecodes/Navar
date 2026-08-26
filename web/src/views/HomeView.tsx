import { useMemo } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Cover, CollectionArt } from "../components/PixelArt";
import { PersonTile } from "../components/PersonTile";
import { Empty, Screen, SectionHeader, Skeleton } from "../components/ui";
import { ArrowRightIcon, PlayIcon } from "../icons";
import { usePlayer } from "../context/PlayerContext";
import { personName, pluralise, trackArtist, trackTitle } from "../lib/format";
import { cached, cacheKey, ttl, useCached } from "../lib/cache";
import { haptic } from "../telegram";

/**
 * The first thing you see.
 *
 * Everything on this screen is either something you were already doing,
 * something somebody you know is doing, or something the app is asking you to
 * finish. There is no editorial shelf and nothing recommended: Navaar knows
 * only what you and your friends forwarded to it.
 *
 * One request holds the whole screen. It is the view that wakes a sleeping
 * instance, and a shelf per call would pay that cost once per shelf — so the
 * server composes it and this file renders what arrived. A section that is
 * missing from the payload is missing from the screen entirely: no header, no
 * placeholder, no explanation of what would have been there.
 *
 * Nothing is reachable only from here. Every shelf is a ranked, finite window
 * onto a screen that keeps all of it, so a row scrolling off the end of Home
 * never takes anything with it.
 */
export function HomeView({ nav }: { nav: Navigation }) {
  const { current, playFrom } = usePlayer();

  // Held across the remount every navigation performs, so coming back to Home
  // paints the shelves in the first frame and revalidates behind them.
  const {
    data: home,
    error,
    refresh,
  } = useCached(cacheKey.home, api.getHome, ttl.home);

  // What you have on now goes to the head of the shelf. It is the one thing on
  // this screen the client knows better than the server does: a play is
  // reported once it has genuinely been listened to, so the track that started
  // thirty seconds ago is not in the payload yet.
  const shelf = useMemo(() => {
    const base = home?.continue_listening ?? [];
    if (!current) return base;
    return [current, ...base.filter((t) => t.id !== current.id)];
  }, [current, home]);

  if (error && !home) {
    // Inside a Screen, or it paints from the top of the window with the
    // top bar sitting on it and nothing clearing the bottom furniture.
    return (
      <Screen>
        <Empty
          title="Home did not load"
          body="Nothing is lost. This was the connection, most likely."
          action="Try again"
          onAction={refresh}
        />
      </Screen>
    );
  }

  if (!home) {
    return (
      <Screen>
        <Skeleton />
      </Screen>
    );
  }

  // No music of your own, played or filed. Whatever else the payload holds,
  // the only thing worth saying is how to get a first track in — and the
  // friends' half of this screen is on the Social tab as well, so nothing is
  // hidden by saying it.
  if (!home.continue_listening && !home.playlists) return <FirstRun />;

  return (
    <Screen>
      {shelf.length > 0 ? (
        <>
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
                    fontSize: 11,
                    color: "var(--color-nav-muted)",
                  }}
                >
                  {trackArtist(track)}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {home.playlists ? (
        <>
          <SectionHeader
            title="Your playlists"
            action="All"
            onAction={() => nav.push({ type: "library" })}
          />
          <div className="nav-shelf nav-shelf-bleed" style={{ gap: 12 }}>
            {home.playlists.map((playlist, i) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                subtitle={pluralise(playlist.track_count ?? 0, "track")}
                index={i}
                onOpen={() => nav.push({ type: "playlist", id: playlist.id, name: playlist.name })}
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Only people who turned listening on, and only inside the window their
          own setting describes. Nobody who opted out leaves a gap here — a row
          saying somebody is private is the one thing they asked not to say. */}
      {home.friend_activity ? (
        <>
          <SectionHeader title="Listening now" />
          <div className="nav-shelf" style={{ gap: 12 }}>
            {home.friend_activity.map((row, i) => (
              <PersonTile
                key={row.person.telegram_user_id}
                person={row.person}
                line={trackTitle(row.track)}
                index={i}
                onOpen={() =>
                  nav.push({
                    type: "profile",
                    userId: Number(row.person.telegram_user_id),
                  })
                }
              />
            ))}
          </div>
        </>
      ) : null}

      {home.from_friends ? (
        <>
          <SectionHeader title="From your friends" />
          <div className="nav-shelf nav-shelf-bleed" style={{ gap: 12 }}>
            {home.from_friends.map((playlist, i) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                subtitle={personName(playlist.person)}
                index={i}
                onOpen={() => nav.push({ type: "playlist", id: playlist.id, name: playlist.name })}
              />
            ))}
          </div>
        </>
      ) : null}

      {home.unsorted ? (
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
            color: "var(--color-nav-action-soft)",
            fontSize: 12,
          }}
        >
          <span className="nav-clip" style={{ flex: 1, textAlign: "left" }}>
            {pluralise(home.unsorted, "track")} haven&rsquo;t found a home yet
          </span>
          <ArrowRightIcon size={13} style={{ color: "var(--color-nav-action)" }} />
        </button>
      ) : null}
    </Screen>
  );
}

/**
 * A playlist in a home shelf — yours, or one a friend shares with you.
 *
 * The art is on top and the name is under it, in that order and never
 * overlapping: a cover is a picture of the playlist, not a background for its
 * own label. Nothing is cropped or absolutely positioned over anything else,
 * so a long name wraps to two lines and the card below it stays where it is.
 *
 * The Play disc sits in the art's bottom-right corner the way the reference
 * puts a lime circle at the head of its primary action. It overlaps the art by
 * a few pixels rather than taking a row of its own, which is what keeps the
 * card the size of its cover instead of the size of its controls. Every card
 * carries one — the old layout gave a Play only to the first, which meant the
 * shelf taught you a control that then vanished. A friend's card carries one
 * too: the route behind it reads visibility rather than ownership, so playing
 * theirs works exactly as playing yours does.
 *
 * The line under the name is the one thing that differs between the two
 * shelves, and it is passed in rather than inferred: yours says how much is in
 * it, theirs says whose it is.
 */
const CARD = 138;

function PlaylistCard({
  playlist,
  subtitle,
  index,
  onOpen,
}: {
  playlist: {
    id: string;
    name: string;
    has_cover?: boolean;
    updated_at: string;
    cover_track_id?: string | null;
  };
  subtitle: string;
  index: number;
  onOpen: () => void;
}) {
  const { playFrom } = usePlayer();

  return (
    <div
      className="nav-rise"
      style={
        {
          "--i": index,
          width: CARD,
          flex: "none",
          position: "relative",
        } as React.CSSProperties
      }
    >
      <button
        className="nav-press"
        onClick={() => {
          haptic.tap();
          onOpen();
        }}
        style={{ display: "block", width: "100%", textAlign: "left" }}
      >
        <CollectionArt
          name={playlist.name}
          coverTrackId={playlist.cover_track_id}
          src={api.playlistArtworkUrl(playlist)}
          size={CARD}
          radius={14}
        />
        <span
          className="nav-clip"
          style={{
            display: "block",
            marginTop: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {playlist.name}
        </span>
        <span
          className="nav-clip"
          style={{
            display: "block",
            marginTop: 1,
            fontSize: 11,
            color: "var(--color-nav-muted)",
          }}
        >
          {subtitle}
        </span>
      </button>

      <button
        className="nav-press"
        aria-label={`Play ${playlist.name}`}
        onClick={() => {
          haptic.press();
          void cached(
            cacheKey.playlistTracks(playlist.id),
            () => api.listPlaylistTracks(playlist.id),
            ttl.playlistTracks
          ).then((rows) =>
            playFrom({
              label: playlist.name,
              key: `playlist:${playlist.id}`,
              tracks: rows,
            })
          );
        }}
        style={{
          position: "absolute",
          right: 7,
          top: CARD - 43,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: 18,
          background: "var(--color-nav-action)",
          color: "#0A0A0A",
          boxShadow: "0 6px 18px rgba(223,252,142,.34)",
        }}
      >
        <PlayIcon size={13} />
      </button>
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
            color: "var(--color-nav-muted)",
            maxWidth: 280,
          }}
        >
          Long-press a track in any chat → Forward → @navaar_bot
        </p>
      </div>
    </Screen>
  );
}
