import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as api from "../api";
import { CollectionArt } from "../components/PixelArt";
import { Empty, Skeleton } from "../components/ui";
import { PauseIcon, PlayIcon } from "../icons";
import { formatDuration, pluralise } from "../lib/format";
import { hideSplash } from "../lib/splash";
import type { SharedPlaylistPage, SharedTrack } from "../types";

/**
 * The one screen of Navaar that runs outside Telegram.
 *
 * Everything else in this app assumes a session, a Telegram host and a
 * navigation stack. This has none of the three, which is why it is reached from
 * App rather than pushed onto the stack, and why it keeps its own audio element
 * instead of using PlayerContext — there is no library here to queue into, no
 * favourites to toggle and nobody to be.
 *
 * It is read-only by design: no save, no queue, no ⋯ menu, and no credits. A
 * stranger holding a link should not come away with a map of who passed what to
 * whom. What they get is the playlist, the name of whoever published it, and one
 * way into the real app.
 *
 * The theme is the app's own rather than a marketing skin, because this page is
 * the product demo: the person opening it is being shown what Navaar looks like.
 */
export function SharedView({ slug }: { slug: string }) {
  const [playlist, setPlaylist] = useState<SharedPlaylistPage | null>(null);
  const [tracks, setTracks] = useState<SharedTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // This screen has a real loading state of its own — the skeleton below — so
  // index.html's splash has done its job the moment this commits. Nobody else
  // will take it down on this route: the share page never reaches Boot.
  useLayoutEffect(() => hideSplash(), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    Promise.all([api.getSharedPlaylist(slug), api.listSharedTracks(slug)])
      .then(([page, rows]) => {
        if (!live) return;
        setPlaylist(page);
        setTracks(rows);
        document.title = `${page.name} · Navaar`;
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : "This link is not live");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [slug]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        zIndex: 1,
      }}
    >
      <SharedHeader />
      {error ? (
        <Empty
          title="This link is not live"
          body="Whoever shared it may have made the playlist private, or replaced the link with a new one."
        />
      ) : loading || !playlist ? (
        <div style={{ padding: "76px 16px 0" }}>
          <Skeleton rows={7} />
        </div>
      ) : (
        <SharedPlaylistBody playlist={playlist} tracks={tracks} slug={slug} />
      )}
    </div>
  );
}

/**
 * The wordmark, in place of the app's TopBar.
 *
 * The bar this page needs is not the one the shell draws: there is no title to
 * print (the playlist names itself six lines below), no search and no avatar.
 * What it does need is to say whose product this is, on a page somebody reached
 * from a link in a chat with no other context.
 */
function SharedHeader() {
  return (
    <header className="nav-topbar">
      <span
        // No tracking of its own: .nav-display already sets the pixel face's,
        // and the same word set two ways in one product is the kind of thing
        // you notice without being able to say why.
        className="nav-display"
        style={{ flex: 1, fontSize: 17 }}
      >
        Navaar
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--color-nav-muted)",
        }}
      >
        Shared
      </span>
    </header>
  );
}

function SharedPlaylistBody({
  playlist,
  tracks,
  slug,
}: {
  playlist: SharedPlaylistPage;
  tracks: SharedTrack[];
  slug: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const current = tracks.find((t) => t.id === currentId) ?? null;

  const play = useCallback(
    (track: SharedTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (track.id === currentId) {
        if (audio.paused) void audio.play();
        else audio.pause();
        return;
      }
      setCurrentId(track.id);
      setProgress(0);
      audio.src = api.sharedStreamUrl(slug, track.id);
      // A browser outside Telegram may refuse to play before a gesture; every
      // call here is inside one, so a rejection means the audio itself failed
      // and the row simply goes back to being idle.
      void audio.play().catch(() => setPlaying(false));
    },
    [currentId, slug]
  );

  /** One song ends and the next begins, as it would in the app. */
  const advance = useCallback(() => {
    const at = tracks.findIndex((t) => t.id === currentId);
    const next = at >= 0 ? tracks[at + 1] : undefined;
    if (next) play(next);
    else {
      setPlaying(false);
      setCurrentId(null);
    }
  }, [tracks, currentId, play]);

  return (
    <>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={advance}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setProgress(el.duration > 0 ? el.currentTime / el.duration : 0);
        }}
      />

      <div
        className="nav-scroll nav-screen"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: "0 14px",
          paddingTop: "calc(var(--nav-topbar-h) + 10px)",
          // This page is a browser page rather than a Mini App, so env() is the
          // right inset here — the rule against it applies inside Telegram's
          // WebView, where it resolves to zero.
          paddingBottom: "calc(140px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div
          className="nav-rise"
          style={{ display: "flex", gap: 14, alignItems: "flex-end" }}
        >
          <CollectionArt
            name={playlist.name}
            coverTrackId={null}
            src={
              api.sharedPlaylistCoverUrl(playlist) ??
              (playlist.cover_track_id
                ? api.sharedTrackCoverUrl(slug, playlist.cover_track_id)
                : null)
            }
            size={104}
            radius={16}
          />
          <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
            <h1
              className="nav-display"
              style={{ margin: 0, fontSize: 21, lineHeight: 1.15 }}
            >
              {playlist.name}
            </h1>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 11.5,
                color: "var(--color-nav-muted)",
              }}
            >
              {playlist.owner_name ? `@${playlist.owner_name} · ` : ""}
              {pluralise(playlist.track_count, "track")}
            </p>
          </div>
        </div>

        {playlist.description ? (
          <p
            className="nav-rise"
            style={{
              marginTop: 12,
              marginBottom: 0,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "rgba(255,255,255,.62)",
              whiteSpace: "pre-wrap",
            }}
          >
            {playlist.description}
          </p>
        ) : null}

        <div style={{ marginTop: 18 }}>
          {tracks.length === 0 ? (
            <Empty
              title="Nothing in here yet"
              body="Whoever shared this hasn't added any tracks to it."
            />
          ) : (
            tracks.map((track, index) => (
              <SharedRow
                key={track.id}
                track={track}
                index={index}
                slug={slug}
                playing={playing && track.id === currentId}
                current={track.id === currentId}
                onPlay={() => play(track)}
              />
            ))
          )}
        </div>
      </div>

      <SharedFooter
        appLink={playlist.app_link}
        current={current}
        playing={playing}
        progress={progress}
        slug={slug}
        onToggle={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play();
          else audio.pause();
        }}
      />
    </>
  );
}

/**
 * A track on the share page.
 *
 * Deliberately not TrackRow: that row carries a heart, a ⋯ menu, a selection
 * checkbox and the credit avatar of whoever contributed the track, and every
 * one of those is either meaningless or a leak here. What is left is the
 * artwork, the name, and a tap to hear it.
 */
function SharedRow({
  track,
  index,
  slug,
  playing,
  current,
  onPlay,
}: {
  track: SharedTrack;
  index: number;
  slug: string;
  playing: boolean;
  current: boolean;
  onPlay: () => void;
}) {
  return (
    <button
      className="nav-press nav-row-in"
      onClick={onPlay}
      style={
        {
          "--i": index,
          display: "flex",
          alignItems: "center",
          gap: 11,
          width: "100%",
          height: 52,
          borderRadius: 12,
          padding: "0 8px",
          margin: "0 -8px",
          textAlign: "left",
          background: current ? "rgba(var(--color-nav-action-rgb),.07)" : undefined,
          transition: "background-color var(--dur-state) var(--ease)",
        } as React.CSSProperties
      }
    >
      <CollectionArt
        name={track.id}
        coverTrackId={null}
        src={track.has_cover ? api.sharedTrackCoverUrl(slug, track.id) : null}
        size={40}
        radius={9}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          className="nav-clip"
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: current ? "var(--color-nav-action)" : "#fff",
            transition: "color var(--dur-state) var(--ease)",
          }}
        >
          {track.title ?? "Untitled"}
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
          {track.artist ?? "Unknown artist"}
          {track.duration_seconds
            ? ` · ${formatDuration(track.duration_seconds)}`
            : ""}
        </span>
      </span>
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: 30,
          display: "grid",
          placeItems: "center",
          color: current ? "var(--color-nav-action)" : "var(--color-nav-faint)",
        }}
      >
        {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
      </span>
    </button>
  );
}

/**
 * The bar that never leaves.
 *
 * It carries two things: whatever is playing, and the way into the app. The
 * call to action is persistent rather than a banner that can be dismissed —
 * this page exists to be the front door, and somebody halfway through a
 * playlist they like is exactly who should be able to reach for it.
 */
function SharedFooter({
  appLink,
  current,
  playing,
  progress,
  slug,
  onToggle,
}: {
  appLink: string | null;
  current: SharedTrack | null;
  playing: boolean;
  progress: number;
  slug: string;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: "var(--z-bottom-bar)",
        padding: "0 12px calc(12px + env(safe-area-inset-bottom, 0px))",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {current ? (
        <div
          className="nav-bar-glass nav-bar-in"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 58,
            padding: "0 10px",
            borderRadius: 16,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* The only progress this page shows: a hairline across the bar,
              which reads at a glance and cannot be mistaken for a control. */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              height: 2,
              // Scaled rather than widened: a width that changes relays out the
              // row under it on every tick of a bar that ticks four times a
              // second.
              width: "100%",
              transformOrigin: "left center",
              transform: `scaleX(${progress})`,
              background: "var(--color-nav-action)",
              transition: "transform 240ms linear",
            }}
          />
          <CollectionArt
            name={current.id}
            coverTrackId={null}
            src={current.has_cover ? api.sharedTrackCoverUrl(slug, current.id) : null}
            size={40}
            radius={9}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              className="nav-clip"
              style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}
            >
              {current.title ?? "Untitled"}
            </span>
            <span
              className="nav-clip"
              style={{
                display: "block",
                fontSize: 11,
                color: "var(--color-nav-muted)",
              }}
            >
              {current.artist ?? "Unknown artist"}
            </span>
          </span>
          <button
            className="nav-press"
            aria-label={playing ? "Pause" : "Play"}
            onClick={onToggle}
            style={{
              width: 38,
              height: 38,
              flex: "none",
              display: "grid",
              placeItems: "center",
              borderRadius: 19,
              background: "var(--color-nav-action)",
              color: "#0A0A0A",
            }}
          >
            {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
          </button>
        </div>
      ) : null}

      {appLink ? (
        <a
          className="nav-press"
          href={appLink}
          style={{
            display: "grid",
            placeItems: "center",
            height: 46,
            borderRadius: 15,
            background: "var(--color-nav-action)",
            color: "#0A0A0A",
            fontSize: 13.5,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            textDecoration: "none",
          }}
        >
          Open in Telegram
        </a>
      ) : null}
    </div>
  );
}
