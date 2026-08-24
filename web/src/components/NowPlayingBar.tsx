import { useEffect, useRef } from "react";
import { usePlayer } from "../context/PlayerContext";
import { Cover } from "./PixelArt";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../icons";
import { trackArtist, trackTitle } from "../lib/format";
import { setFocalOrigin } from "../lib/focal";
import { haptic } from "../telegram";

/**
 * The bar that sits above the nav whenever something is loaded.
 *
 * Progress lives in the ring around the play button rather than in a line
 * across the bar. A 2px line at the top of a 58px pill is invisible on a phone
 * held at arm's length, and the ring puts the one piece of continuously
 * changing information on the one control you always look at.
 *
 * The bar also publishes two things the rest of the shell needs: its own
 * height, as --nav-nowplaying-h, so every scrollable view can reserve space
 * for it the first time something plays; and its artwork element, which is
 * where the player's hero square grows from.
 */
export function NowPlayingBar({ onOpen }: { onOpen: () => void }) {
  const { current, isPlaying, position, duration, toggle, next, prev } = usePlayer();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Measured rather than assumed: the pill is a fixed 58px today, but the
  // padding around it is the only thing standing between the bar and the last
  // row of a list, and getting that wrong hides a track behind the glass.
  useEffect(() => {
    const el = wrapRef.current;
    const root = document.documentElement;
    if (!el || !current) {
      root.style.setProperty("--nav-nowplaying-h", "0px");
      return;
    }
    const measure = () =>
      root.style.setProperty("--nav-nowplaying-h", `${el.offsetHeight}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--nav-nowplaying-h", "0px");
    };
  }, [current]);

  if (!current) return null;

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const sweep = `${(progress * 100).toFixed(1)}%`;

  return (
    <div
      ref={wrapRef}
      className="nav-bar-in"
      style={{ flex: "none", padding: "8px 12px 0", position: "relative", zIndex: 30 }}
    >
      <div
        className="nav-glass"
        style={{
          display: "flex",
          alignItems: "center",
          height: 58,
          borderRadius: 29,
          padding: "0 8px",
        }}
      >
        <button
          className="nav-press"
          aria-label={`Open player. ${trackTitle(current)}`}
          onClick={() => {
            haptic.tap();
            onOpen();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flex: 1,
            minWidth: 0,
            height: 58,
            textAlign: "left",
          }}
        >
          {/* The origin of the player transition: the hero square grows
              out of this disc, so the element itself is registered. */}
          <span ref={setFocalOrigin} style={{ display: "flex", flex: "none" }}>
            <Cover trackId={current.id} hasCover={current.has_cover} size={42} radius={21} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              className="nav-clip"
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              {trackTitle(current)}
            </span>
            <span
              className="nav-clip"
              style={{
                display: "block",
                fontSize: 10.5,
                color: "rgba(255,255,255,.52)",
                marginTop: 1,
              }}
            >
              {trackArtist(current)}
            </span>
          </span>
        </button>

        <button
          aria-label="Previous"
          className="nav-press"
          onClick={() => {
            haptic.tap();
            prev();
          }}
          style={{
            width: 36,
            height: 44,
            flex: "none",
            display: "grid",
            placeItems: "center",
            color: "rgba(255,255,255,.64)",
          }}
        >
          <PrevIcon size={16} />
        </button>

        <button
          aria-label={isPlaying ? "Pause" : "Play"}
          className="nav-press"
          onClick={() => {
            haptic.tap();
            toggle();
          }}
          style={{
            width: 44,
            height: 44,
            flex: "none",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            // The ring is the scrubber. Lime up to the play head, dim after.
            background: `conic-gradient(var(--color-nav-action) 0 ${sweep}, rgba(255,255,255,.13) 0)`,
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(10,10,10,.72)",
              display: "grid",
              placeItems: "center",
              color: "var(--color-nav-action)",
            }}
          >
            {/* Stacked and cross-faded so the button never blinks empty. */}
            <span style={{ display: "grid", placeItems: "center" }}>
              <PlayIcon
                size={14}
                className="nav-glyph"
                style={{ gridArea: "1 / 1" }}
                data-hidden={isPlaying}
              />
              <PauseIcon
                size={14}
                className="nav-glyph"
                style={{ gridArea: "1 / 1" }}
                data-hidden={!isPlaying}
              />
            </span>
          </span>
        </button>

        <button
          aria-label="Next"
          className="nav-press"
          onClick={() => {
            haptic.tap();
            next();
          }}
          style={{
            width: 36,
            height: 44,
            flex: "none",
            display: "grid",
            placeItems: "center",
            color: "rgba(255,255,255,.64)",
          }}
        >
          <NextIcon size={16} />
        </button>
      </div>
    </div>
  );
}
