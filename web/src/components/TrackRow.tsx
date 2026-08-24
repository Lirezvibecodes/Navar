import { useState } from "react";
import type { Track } from "../types";
import { Cover } from "./PixelArt";
import { Avatar } from "./Avatar";
import { CheckIcon, DotsIcon, HeartIcon } from "../icons";
import { formatDuration, trackArtist, trackTitle } from "../lib/format";
import { haptic } from "../telegram";
import { useLongPress } from "./ui";

/**
 * One track, everywhere a track appears in a list.
 *
 * The row is 52px with a 40px square, and the two trailing controls sit in
 * 44px-tall hit areas that overhang the row above and below. That overhang is
 * deliberate: shrinking the row to fit two comfortable targets would fit six
 * tracks on a screen instead of nine, and a library is read by scanning.
 */

/** Wraps the matched run so incremental search shows why a row survived. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark
        style={{
          background: "rgba(223,252,142,.22)",
          color: "inherit",
          borderRadius: 3,
          padding: "0 1px",
        }}
      >
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

export interface TrackRowProps {
  track: Track;
  index?: number;
  playing?: boolean;
  /** Whether this row is yours to heart and edit. */
  owned?: boolean;
  favorited?: boolean;
  query?: string;
  /** Shown instead of the artist when a list is already one artist deep. */
  secondary?: string;

  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onEnterSelection?: () => void;

  onPlay: () => void;
  onMenu?: () => void;
  onToggleFavorite?: () => void;
}

export function TrackRow({
  track,
  index = 0,
  playing = false,
  owned = true,
  favorited = false,
  query = "",
  secondary,
  selectable = false,
  selected = false,
  onSelect,
  onEnterSelection,
  onPlay,
  onMenu,
  onToggleFavorite,
}: TrackRowProps) {
  const press = useLongPress(() => onEnterSelection?.());

  // The heart pops only while it is being filled — never on a rerender that
  // happens to carry a favourite the row already had.
  const [popping, setPopping] = useState(false);

  const meta = secondary ?? trackArtist(track);
  const credit = track.credit_user_id && track.credit_username;

  return (
    <div
      className="nav-row-in"
      style={
        {
          "--i": index,
          display: "flex",
          alignItems: "center",
          gap: 11,
          height: 52,
          borderRadius: 12,
          padding: "0 8px",
          margin: "0 -8px",
          background: playing
            ? "rgba(223,252,142,.07)"
            : selected
              ? "rgba(255,255,255,.05)"
              : undefined,
          transition: "background-color var(--dur-state) var(--ease)",
        } as React.CSSProperties
      }
    >
      {selectable ? (
        <button
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? "Deselect" : "Select"}
          className="nav-press"
          onClick={() => {
            haptic.select();
            onSelect?.();
          }}
          style={{
            width: 22,
            height: 44,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: -2,
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0A0A0A",
              background: selected ? "var(--color-nav-action)" : "transparent",
              border: selected ? "none" : "1.5px solid rgba(255,255,255,.28)",
              transition:
                "background-color var(--dur-tap) var(--ease), border-color var(--dur-tap) var(--ease)",
            }}
          >
            <CheckIcon size={12} style={{ opacity: selected ? 1 : 0 }} />
          </span>
        </button>
      ) : null}

      <button
        className="nav-press"
        {...press}
        onClick={() => {
          if (press.consumed()) return;
          haptic.tap();
          if (selectable) onSelect?.();
          else onPlay();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          flex: 1,
          minWidth: 0,
          height: 52,
          textAlign: "left",
        }}
      >
        <Cover trackId={track.id} hasCover={track.has_cover} size={40} radius={9} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            className="nav-clip"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: playing ? "var(--color-nav-action)" : "#fff",
              transition: "color var(--dur-state) var(--ease)",
            }}
          >
            <Highlighted text={trackTitle(track)} query={query} />
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginTop: 1,
              fontSize: 11,
              color: "rgba(255,255,255,.52)",
              minWidth: 0,
            }}
          >
            {credit ? (
              <Avatar
                userId={track.credit_user_id!}
                username={track.credit_username}
                size={14}
              />
            ) : null}
            <span className="nav-clip">
              <Highlighted text={meta} query={query} />
            </span>
            {track.duration_seconds ? (
              <span style={{ flex: "none", opacity: 0.72 }}>
                · {formatDuration(track.duration_seconds)}
              </span>
            ) : null}
          </span>
        </span>
      </button>

      {selectable ? null : (
        <>
          {onMenu ? (
            <button
              aria-label="More"
              className="nav-press"
              onClick={() => {
                haptic.tap();
                onMenu();
              }}
              style={{
                width: 30,
                height: 44,
                flex: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,.35)",
              }}
            >
              <DotsIcon size={17} />
            </button>
          ) : null}

          {owned && onToggleFavorite ? (
            <button
              aria-label={favorited ? "Remove from favourites" : "Add to favourites"}
              aria-pressed={favorited}
              className={`nav-press ${popping ? "nav-pop" : ""}`}
              onAnimationEnd={() => setPopping(false)}
              onClick={() => {
                haptic.tap();
                if (!favorited) setPopping(true);
                onToggleFavorite();
              }}
              style={{
                width: 26,
                height: 44,
                flex: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: favorited
                  ? "var(--color-nav-action)"
                  : "rgba(255,255,255,.22)",
              }}
            >
              <HeartIcon size={15} />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
