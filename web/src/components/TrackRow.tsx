import { useState } from "react";
import type { Track } from "../types";
import { Cover } from "./PixelArt";
import { Avatar } from "./Avatar";
import { CheckIcon, DotsIcon, HeartIcon, PlayNextIcon, QueueAddIcon } from "../icons";
import { formatDuration, trackArtist, trackTitle, trackUploader } from "../lib/format";
import { haptic } from "../telegram";
import { useLibrary } from "../context/LibraryContext";
import { useLongPress, useSwipeQueue } from "./ui";

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
          background: "rgba(var(--color-nav-action-rgb),.22)",
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
  /** Swipe right, past the second threshold, to play this next. Optional — a
   *  row with neither of these two just doesn't grow the swipe affordance. */
  onQueueNext?: () => void;
  onQueueLast?: () => void;
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
  onQueueNext,
  onQueueLast,
}: TrackRowProps) {
  const { me } = useLibrary();
  const press = useLongPress(() => onEnterSelection?.());
  const canSwipe = !selectable && !!(onQueueNext || onQueueLast);
  const swipe = useSwipeQueue(
    () => (onQueueLast ?? onQueueNext)?.(),
    () => (onQueueNext ?? onQueueLast)?.()
  );

  // The heart pops only while it is being filled — never on a rerender that
  // happens to carry a favourite the row already had.
  const [popping, setPopping] = useState(false);

  const meta = secondary ?? trackArtist(track);
  // Who put it here, when that is somebody other than you. A library is mostly
  // your own uploads, and a row that says your own name nine times in a screen
  // is nine rows of nothing — the tag is worth its width exactly when the
  // answer is somebody else. The face is the credit avatar this line already
  // carried; all that is new is that it now says whose it is.
  const uploader = trackUploader(track, me?.id);
  const tag = uploader && !uploader.you ? uploader : null;

  const revealStage = canSwipe ? swipe.stage : "none";

  return (
    <div
      className="nav-row-in"
      style={
        {
          "--i": index,
          position: "relative",
          borderRadius: 12,
          margin: "0 -8px",
          overflow: canSwipe ? "hidden" : undefined,
        } as React.CSSProperties
      }
    >
      {canSwipe ? (
        // Sits behind the row and only shows through the gap the swipe opens
        // up — the same "play next" / "add to queue" actions TrackMenu already
        // offers, just reachable a beat faster from the row itself.
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            paddingLeft: 14,
            gap: 6,
            fontSize: 11.5,
            fontWeight: 600,
            color: "#0A0A0A",
            background: "var(--color-nav-action)",
            opacity: revealStage === "none" ? 0 : 1,
            transition: "opacity var(--dur-tap) var(--ease)",
          }}
        >
          {revealStage === "next" ? <PlayNextIcon size={15} /> : <QueueAddIcon size={15} />}
          {revealStage === "next" ? "Play next" : "Add to queue"}
        </div>
      ) : null}

      <div
        {...(canSwipe
          ? {
              onPointerDown: swipe.onPointerDown,
              onPointerMove: swipe.onPointerMove,
              onPointerUp: swipe.onPointerUp,
              onPointerCancel: swipe.onPointerCancel,
              onPointerLeave: swipe.onPointerLeave,
            }
          : {})}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          height: 52,
          padding: "0 8px",
          borderRadius: 12,
          background: playing
            ? "rgba(var(--color-nav-action-rgb),.07)"
            : selected
              ? "rgba(255,255,255,.05)"
              : "var(--color-nav-bg)",
          transform: canSwipe && swipe.dragX ? `translateX(${swipe.dragX}px)` : undefined,
          transition:
            canSwipe && swipe.dragging()
              ? "background-color var(--dur-state) var(--ease)"
              : "background-color var(--dur-state) var(--ease), transform var(--dur-tap) var(--ease)",
          touchAction: canSwipe ? "pan-y" : undefined,
        }}
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
              border: selected ? "none" : "1.5px solid var(--color-nav-faint)",
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
        <span style={{ position: "relative", flex: "none" }}>
          <Cover trackId={track.id} hasCover={track.has_cover} size={40} radius={9} />
          {/* Whose it is, when that is somebody other than you — pinned to the
              cover's corner rather than sharing the subtitle line, so it never
              crowds out the artist name the line already exists to show. */}
          {tag ? (
            <span
              className="nav-uploader-badge"
              title={`Added by @${tag.name}`}
              style={{
                position: "absolute",
                right: -3,
                bottom: -3,
              }}
            >
              <Avatar userId={tag.id} username={tag.name} size={16} />
            </span>
          ) : null}
        </span>
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
              fontSize: 11.5,
              color: "var(--color-nav-muted)",
              minWidth: 0,
            }}
          >
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
        // One group with no gap between the two, so each glyph can carry a 40px
        // target of its own. At 30px and 26px they were the two smallest hit
        // areas in the app and they sat 11px apart, which is close enough that
        // a thumb aiming for the heart opened the menu instead.
        <div style={{ display: "flex", flex: "none", alignItems: "center" }}>
          {onMenu ? (
            <button
              aria-label="More"
              className="nav-press"
              onClick={() => {
                haptic.tap();
                onMenu();
              }}
              style={{
                width: 40,
                height: 44,
                flex: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-nav-faint)",
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
                width: 40,
                height: 44,
                flex: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: favorited
                  ? "var(--color-nav-action)"
                  : "var(--color-nav-ghost)",
              }}
            >
              <HeartIcon size={16} />
            </button>
          ) : null}
        </div>
      )}
      </div>
    </div>
  );
}
