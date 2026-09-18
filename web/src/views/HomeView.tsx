import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Cover, CollectionArt } from "../components/PixelArt";
import { PersonTile } from "../components/PersonTile";
import { Counted, Screen, SectionHeader, Skeleton, Empty } from "../components/ui";
import { ArrowRightIcon, PlayIcon } from "../icons";
import { usePlayer } from "../context/PlayerContext";
import { personName, trackArtist, trackTitle } from "../lib/format";
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
/**
 * TEMPORARY diagnostic only — logs raw touch events on Home so we can see
 * what actually happens on a real device when a drag over a button fails to
 * scroll. Remove once the Home scroll bug is found. Pointer-events: none so
 * it cannot itself interfere with the gesture it is watching.
 */
function TouchDebugOverlay() {
  const [lines, setLines] = useState<string[]>([]);
  const startY = useRef<number | null>(null);
  const pending = useRef<string[]>([]);

  // Batched rather than one POST per event: touchmove alone can fire dozens
  // of times a second, and none of this needs to arrive faster than a human
  // reads it.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (pending.current.length === 0) return;
      const batch = pending.current;
      pending.current = [];
      api.postDebugTouchLog(batch);
    }, 600);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const describe = (t: EventTarget | null): string => {
      if (!(t instanceof Element)) return "?";
      const cls = t.className ? "." + String(t.className).split(" ").slice(0, 2).join(".") : "";
      return t.tagName.toLowerCase() + cls;
    };
    const log = (s: string) => {
      setLines((prev) => [...prev.slice(-13), s]);
      pending.current.push(`${new Date().toISOString().slice(11, 23)} ${s}`);
    };

    const onStart = (e: TouchEvent) => {
      startY.current = e.touches[0]?.clientY ?? null;
      log(`start y=${Math.round(startY.current ?? -1)} on ${describe(e.target)}`);
    };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? null;
      const dy = y != null && startY.current != null ? Math.round(y - startY.current) : "?";
      log(`move dy=${dy} defPrevented=${e.defaultPrevented} on ${describe(e.target)}`);
    };
    const onEnd = (e: TouchEvent) => log(`end on ${describe(e.target)}`);
    const onCancel = (e: TouchEvent) => log(`CANCEL on ${describe(e.target)}`);

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        left: 4,
        right: 4,
        top: 4,
        zIndex: 999999,
        pointerEvents: "none",
        background: "rgba(0,0,0,.82)",
        color: "#7CFC7C",
        fontSize: 9.5,
        fontFamily: "monospace",
        lineHeight: 1.35,
        padding: "4px 6px",
        borderRadius: 8,
        maxHeight: "34vh",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
      }}
    >
      {lines.length === 0 ? "touch log: drag on a button…" : lines.join("\n")}
    </div>
  );
}

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
    <>
      <TouchDebugOverlay />
      <Screen scrollKey="home">
      {shelf.length > 0 ? (
        <>
          <SectionHeader title="Continue listening" />
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
                subtitle={<Counted count={playlist.track_count ?? 0} one="track" />}
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
            background: "rgba(var(--color-nav-action-rgb),.09)",
            border: "1px solid rgba(var(--color-nav-action-rgb),.32)",
            color: "var(--color-nav-action-soft)",
            fontSize: 12,
          }}
        >
          <span className="nav-clip" style={{ flex: 1, textAlign: "left" }}>
            <Counted count={home.unsorted} one="track" /> haven&rsquo;t found a home
            yet
          </span>
          <ArrowRightIcon size={13} style={{ color: "var(--color-nav-action)" }} />
        </button>
      ) : null}
      </Screen>
    </>
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
  subtitle: React.ReactNode;
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
          boxShadow: "0 6px 18px rgba(var(--color-nav-action-rgb),.34)",
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
          padding: "30px 16px 0",
          textAlign: "center",
        }}
      >
        <h2 className="nav-display" style={{ margin: 0, fontSize: 20 }}>
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
