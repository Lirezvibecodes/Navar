import { Cover } from "./PixelArt";
import { ActionButton, Num } from "./ui";
import { PauseIcon, PlayIcon } from "../icons";
import { usePlayer } from "../context/PlayerContext";
import { formatDuration, trackArtist, trackTitle } from "../lib/format";
import { haptic } from "../telegram";
import type { Track } from "../types";

/**
 * The deck: the tape you are on, at the top of Home.
 *
 * Home used to open on a shelf of 72px squares, which is a good way to show
 * eight things and a poor way to show the one thing you were doing. This is the
 * one thing — either what is playing, or the track you stopped in the middle
 * of — drawn large enough that the screen has somewhere to start.
 *
 * It is a cassette because Navaar already is one. The whole app is set on a
 * pixel grid, the artwork it generates is a four-colour conic tile, the loader
 * is five blocks lighting in sequence — a tape deck is the object that idiom
 * was always describing, and the two reels answer a question a progress bar
 * asks you to read: one is full when the other is empty, and you can see which
 * from across the room.
 *
 * Nothing here is fetched. The track is what Home already has and the position
 * is what the player already knows.
 */

/** The window's box, and the reel that has to fit inside it. */
const REEL = 40;
const HUB = 15;

export function Deck({
  track,
  /** True when this is the track the player is actually holding. */
  live,
  onPlay,
  onOpen,
}: {
  track: Track | null;
  live: boolean;
  onPlay: () => void;
  onOpen: () => void;
}) {
  const { isPlaying, position, duration, toggle } = usePlayer();

  // A track that is loaded but has not reported its length yet falls back to
  // the tag, and a track with neither shows an empty take-up reel rather than
  // a reel wound to NaN.
  const length = live && duration > 0 ? duration : (track?.duration_seconds ?? 0);
  const elapsed = live ? position : 0;
  const wound = length > 0 ? Math.min(1, Math.max(0, elapsed / length)) : 0;
  const spinning = live && isPlaying;

  const label = !live ? "Play" : isPlaying ? "Pause" : "Resume";

  return (
    <div
      className="nav-glass nav-rise"
      style={{
        // 4px, not the app's usual 12–14. A cassette shell is cut, not moulded,
        // and this is the one object on the screen that is meant to look like a
        // thing rather than like a card.
        borderRadius: 4,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 11,
      }}
    >
      {/* The window. Recessed rather than raised: everything else in the app
          floats, and this is the one place something sits *inside* a surface. */}
      <button
        className="nav-press"
        onClick={() => {
          if (!track) return;
          haptic.tap();
          onOpen();
        }}
        disabled={!track}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          borderRadius: 3,
          background: "rgba(0,0,0,.34)",
          boxShadow:
            "inset 0 2px 4px rgba(0,0,0,.55), inset 0 -1px 0 rgba(255,255,255,.06)",
        }}
      >
        {track ? (
          <Cover trackId={track.id} hasCover={track.has_cover} size={56} radius={2} />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              flex: "none",
              borderRadius: 2,
              border: "1px dashed rgba(223,252,142,.34)",
            }}
          />
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-evenly",
          }}
        >
          {/* Supply on the left, take-up on the right. The left one empties as
              the right one fills, which is the only reason there are two. */}
          <Reel wind={1 - wound} spinning={spinning} loaded={track != null} />
          <Reel wind={wound} spinning={spinning} loaded={track != null} />
        </div>
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            className="nav-display nav-clip"
            style={{ display: "block", fontSize: 15, lineHeight: 1.25 }}
          >
            {track ? trackTitle(track) : "No tape in"}
          </span>
          <span
            className="nav-clip"
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 11.5,
              color: "var(--color-nav-muted)",
            }}
          >
            {track ? (
              <>
                {live ? (
                  <>
                    <Num>{formatDuration(elapsed)}</Num>
                    {" · "}
                  </>
                ) : null}
                {trackArtist(track)}
              </>
            ) : (
              "Forward a song to the bot"
            )}
          </span>
        </div>

        {track ? (
          <ActionButton
            grow={false}
            variant="disc"
            height={42}
            icon={spinning ? PauseIcon : PlayIcon}
            onClick={live ? toggle : onPlay}
          >
            {label}
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One reel, on the same grid the favicon is drawn on.
 *
 * The octagon is three overlapping rectangles rather than a circle, for the
 * reason the favicon's play triangle is a staircase: at this size a real curve
 * is a smear, and a shape that admits it is on a grid is legible. The tape is
 * the outer octagon and scales with how much of the song has gone; the hub is
 * fixed, and carries one bright cell so that a reel turning is something you
 * can see rather than something you have to infer.
 */
function Reel({
  wind,
  spinning,
  loaded,
}: {
  /** 0 = bare hub, 1 = a full spool. */
  wind: number;
  spinning: boolean;
  loaded: boolean;
}) {
  const hubFraction = HUB / REEL;
  const tape = REEL * (hubFraction + (1 - hubFraction) * Math.min(1, Math.max(0, wind)));

  return (
    <span
      style={{
        position: "relative",
        flex: "none",
        width: REEL,
        height: REEL,
        display: "grid",
        placeItems: "center",
      }}
    >
      <svg
        viewBox="0 0 11 11"
        aria-hidden="true"
        style={{
          position: "absolute",
          width: tape,
          height: tape,
          shapeRendering: "crispEdges",
          // The wind is read off the audio clock, which ticks about four times
          // a second. Without this the spool grows in visible steps.
          transition: "width var(--dur-state) linear, height var(--dur-state) linear",
        }}
      >
        <g fill={loaded ? "rgba(223,252,142,.17)" : "transparent"}>
          <Octagon />
        </g>
      </svg>

      <svg
        viewBox="0 0 11 11"
        aria-hidden="true"
        style={{
          position: "absolute",
          width: HUB,
          height: HUB,
          shapeRendering: "crispEdges",
          animation: "nav-spin 3.6s linear infinite",
          animationPlayState: spinning ? "running" : "paused",
        }}
      >
        <g fill={loaded ? "rgba(223,252,142,.5)" : "rgba(223,252,142,.22)"}>
          <Octagon />
        </g>
        {/* The spindle hole, punched in the shell's own darkness. */}
        <rect x="4" y="4" width="3" height="3" fill="#0b0b0b" />
        {/* The mark. One cell, full lime, and the whole reason the rotation
            reads at all — an eight-fold symmetric shape spinning looks static. */}
        <rect
          x="5"
          y="1"
          width="1"
          height="2"
          fill={loaded ? "var(--color-nav-action)" : "rgba(223,252,142,.3)"}
        />
      </svg>
    </span>
  );
}

/**
 * A pixel octagon: a tall bar, a wide bar, and a square, unioned. The corners
 * come out cut by exactly one cell, which is what a circle looks like when you
 * only have eleven of them.
 */
function Octagon() {
  return (
    <>
      <rect x="3" y="0" width="5" height="11" />
      <rect x="0" y="3" width="11" height="5" />
      <rect x="1" y="1" width="9" height="9" />
    </>
  );
}
