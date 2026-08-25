import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Cover } from "../components/PixelArt";
import { TrackMenu } from "../components/TrackMenu";
import type { TrackMenuTarget } from "../components/TrackMenu";
import { RoundButton, Sheet, SheetItem } from "../components/ui";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DotsIcon,
  DragIcon,
  HeartIcon,
  MoonIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  ShuffleIcon,
  TrashIcon,
} from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import { applyFocalGrow, focalRiseVars } from "../lib/focal";
import { formatDuration, formatRemaining, trackArtist, trackTitle } from "../lib/format";
import { activeLineAt, parseLyrics, type Lyrics } from "../lib/lyrics";
import { haptic } from "../telegram";
import type { Track } from "../types";

type Pane = "player" | "lyrics" | "queue";

/**
 * The player.
 *
 * Three panes behind a segmented control rather than swipeable pages: the
 * scrubber is a horizontal drag, and a pane that also answers to horizontal
 * drags would fight it every time somebody tries to seek.
 *
 * The screen arrives by growing out of the Now Playing bar — the artwork
 * travels from wherever the bar's little disc actually is, measured rather
 * than assumed. Opened from a track row instead, there is no origin to grow
 * from and it simply rises.
 *
 * It leaves the same way it came: dragged down. See `useDragToDismiss`.
 */
export function PlayerView({ nav, onClose }: { nav: Navigation; onClose: () => void }) {
  const { owns, setFavorite } = useLibrary();
  const { toast } = useToast();
  const {
    current,
    upNext,
    contextNext,
    contextLabel,
    isPlaying,
    position,
    duration,
    shuffle,
    repeat,
    sleepAt,
    toggle,
    next,
    prev,
    seek,
    removeFromQueue,
    moveInQueue,
    clearQueue,
    setShuffle,
    cycleRepeat,
    setSleepMinutes,
  } = usePlayer();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  // Nothing playing means this screen renders nothing, so there is no root to
   // bind to until there is; the flag is what brings the listeners back.
  useDragToDismiss(rootRef, onClose, current != null);
  const [pane, setPane] = useState<Pane>("player");
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [sleepOpen, setSleepOpen] = useState(false);

  // The sleep label counts down, so it needs a clock of its own — reading
  // Date.now() during render would print a time that never changes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sleepAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, [sleepAt]);
  const [hearted, setHearted] = useState(false);

  // The focal grow. Measured in a layout effect so the hero has its final box
  // before the delta is computed, and cleared afterwards so a later re-render
  // does not replay the entrance.
  const [grew, setGrew] = useState(false);
  useLayoutEffect(() => {
    setGrew(applyFocalGrow(artRef.current));
  }, []);

  // Everything below the artwork is fixed furniture; the artwork is what gives
  // way on a short screen. Transport and scrubber never scale — they are the
  // controls, and a smaller play button on a smaller phone is backwards.
  const [artSize, setArtSize] = useState(196);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const height = el.clientHeight;
      const width = el.clientWidth;
      // 320 of furniture below the art, 96 above it.
      const spare = Math.max(120, height - 320);
      setArtSize(Math.round(Math.min(320, Math.min(width - 56, spare))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!current) return null;

  const owned = owns(current);
  const favorited = current.favorited_at != null;

  return (
    <div
      ref={rootRef}
      className={grew ? "nav-player-in" : "nav-rise"}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        // Not inset: 0. A fixed box resolves against the layout viewport, which
        // Android does not shrink for its own keyboard; the player would lay
        // itself out behind it. --tg-viewport-height follows the visual
        // viewport instead. See applyViewport in telegram.ts.
        height: "var(--tg-viewport-height, 100%)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        background: "#030303",
        paddingTop: "var(--nav-top-inset)",
        paddingBottom: "var(--tg-safe-bottom)",
        // The whole screen is a drag-to-dismiss surface (see useDragToDismiss),
        // and on Telegram clients older than 7.7 there is no
        // disableVerticalSwipes to stop the client reading that same drag as
        // "collapse the Mini App". Claiming the vertical axis here is the
        // floor underneath that version gate.
        touchAction: "pan-y",
        ...focalRiseVars(),
      }}
    >
      {/* Header. Telegram draws its own back button, but the player is a sheet
          over the app rather than a pushed screen, so it keeps a visible way
          down as well — the one place a chevron is not a duplicate. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 48,
          padding: "0 14px",
          flex: "none",
        }}
      >
        <RoundButton icon={ChevronDownIcon} label="Close player" onClick={onClose} />
        <span
          className="nav-clip"
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 10.5,
            color: "rgba(255,255,255,.52)",
          }}
        >
          {contextLabel ? `Playing from ${contextLabel}` : "Playing"}
        </span>
        <RoundButton
          icon={DotsIcon}
          label="Track options"
          onClick={() => setMenu({ track: current })}
        />
      </div>

      {pane === "player" ? (
        <div
          className="nav-scroll"
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          <div
            style={{
              display: "grid",
              placeItems: "center",
              padding: "6px 0 4px",
              background:
                "radial-gradient(60% 78% at 50% 46%,rgba(137,174,255,.13),rgba(223,252,142,.05) 46%,transparent 72%)",
            }}
          >
            <div
              ref={artRef}
              className={grew ? "nav-art-in" : undefined}
              style={{
                borderRadius: 14,
                boxShadow: "0 0 60px rgba(223,252,142,.14)",
              }}
            >
              <Cover
                trackId={current.id}
                hasCover={current.has_cover}
                size={artSize}
                radius={14}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px 0",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="nav-clip"
                style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em" }}
              >
                {trackTitle(current)}
              </div>
              <div
                className="nav-clip"
                style={{ fontSize: 12, color: "rgba(255,255,255,.55)", marginTop: 3 }}
              >
                {trackArtist(current)}
              </div>
            </div>
            {owned ? (
              <button
                className={`nav-press ${hearted ? "nav-pop" : ""}`}
                aria-label={favorited ? "Remove from favourites" : "Add to favourites"}
                aria-pressed={favorited}
                onAnimationEnd={() => setHearted(false)}
                onClick={() => {
                  haptic.tap();
                  setHearted(true);
                  void setFavorite(current, !favorited);
                }}
                style={{
                  width: 44,
                  height: 44,
                  flex: "none",
                  display: "grid",
                  placeItems: "center",
                  color: favorited
                    ? "var(--color-nav-action)"
                    : "rgba(255,255,255,.5)",
                }}
              >
                <HeartIcon size={21} />
              </button>
            ) : null}
          </div>

          <Scrubber position={position} duration={duration} onSeek={seek} />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 18px 18px",
            }}
          >
            <TransportButton
              icon={ShuffleIcon}
              label="Shuffle"
              size={52}
              on={shuffle}
              onClick={() => setShuffle(!shuffle)}
            />
            <TransportButton icon={PrevIcon} label="Previous" size={52} bright onClick={prev} />
            <button
              className="nav-press"
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={() => {
                haptic.press();
                toggle();
              }}
              style={{
                width: 70,
                height: 70,
                borderRadius: 35,
                display: "grid",
                placeItems: "center",
                background: "var(--color-nav-action)",
                color: "#0A0A0A",
                boxShadow: "0 8px 26px rgba(223,252,142,.22)",
              }}
            >
              <span style={{ display: "grid", placeItems: "center" }}>
                <PlayIcon
                  size={26}
                  className="nav-glyph"
                  data-hidden={isPlaying}
                  style={{ gridArea: "1 / 1", marginLeft: 3 }}
                />
                <PauseIcon
                  size={26}
                  className="nav-glyph"
                  data-hidden={!isPlaying}
                  style={{ gridArea: "1 / 1" }}
                />
              </span>
            </button>
            <TransportButton icon={NextIcon} label="Next" size={52} bright onClick={next} />
            <TransportButton
              icon={RepeatIcon}
              label={`Repeat ${repeat}`}
              size={52}
              on={repeat !== "off"}
              badge={repeat === "one" ? "1" : undefined}
              onClick={cycleRepeat}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 6 }}>
            <button
              className="nav-press"
              onClick={() => setSleepOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minHeight: 44,
                padding: "0 14px",
                fontSize: 11,
                color: sleepAt ? "var(--color-nav-action)" : "rgba(255,255,255,.45)",
              }}
            >
              <MoonIcon size={13} />
              {sleepAt ? `Stops in ${formatDuration((sleepAt - now) / 1000)}` : "Sleep timer"}
            </button>
          </div>
        </div>
      ) : pane === "lyrics" ? (
        <LyricsPane track={current} position={position} onSeek={seek} />
      ) : (
        <QueuePane
          current={current}
          upNext={upNext}
          contextNext={contextNext}
          contextLabel={contextLabel}
          onRemove={removeFromQueue}
          onMove={moveInQueue}
          onClear={clearQueue}
          onMenu={(track) => setMenu({ track })}
        />
      )}

      <Segments
        pane={pane}
        onSelect={setPane}
        queueCount={upNext.length + contextNext.length}
        hasLyrics={current.has_lyrics}
      />

      <TrackMenu
        target={menu}
        onClose={() => setMenu(null)}
        onGoTo={(to) => {
          setMenu(null);
          onClose();
          nav.push(to);
        }}
      />

      <Sheet open={sleepOpen} onClose={() => setSleepOpen(false)} title="Sleep timer">
        {[15, 30, 45, 60].map((minutes) => (
          <SheetItem
            key={minutes}
            icon={MoonIcon}
            label={`${minutes} minutes`}
            onClick={() => {
              setSleepMinutes(minutes);
              setSleepOpen(false);
              toast(`Stopping in ${minutes} minutes`);
            }}
          />
        ))}
        {sleepAt ? (
          <SheetItem
            icon={TrashIcon}
            label="Turn it off"
            onClick={() => {
              setSleepMinutes(null);
              setSleepOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

// --- Dismissal ---------------------------------------------------------------

/** Past this much of the screen, letting go finishes the dismissal. */
const DISMISS_FRACTION = 0.18;
/** How far the finger travels before the drag stops being a possible scroll. */
const ENGAGE_AT = 10;

/**
 * Drag the player down to put it away.
 *
 * The player fills the screen and its panes scroll, so a downward drag is
 * ambiguous by nature: it is a dismissal only when there is nothing above to
 * scroll to. The rule is the one every sheet of this kind uses — the gesture
 * belongs to the scroller until the scroller is at its top, and to the sheet
 * after that. Without it a swipe down does what the user reported: nothing but
 * scroll, on a pane that was already at the top and had nowhere to go.
 *
 * The listeners are native and non-passive rather than React props, because
 * React registers `touchmove` passively and a passive listener cannot call
 * `preventDefault` — which is the only way to stop the WebView from rubber-
 * banding underneath the drag.
 *
 * While the finger is down the sheet is pinned to it with no transition, so it
 * tracks exactly. Transition comes back only on release, when the sheet either
 * falls away or springs home.
 */
function useDragToDismiss(
  rootRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
  ready: boolean
) {
  // The callback lands in a ref so the listeners are attached once for the
  // life of the screen rather than re-bound whenever the parent re-renders.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let startY = 0;
    let startX = 0;
    let travelled = 0;
    let tracking = false;
    let engaged = false;

    const scroller = () => root.querySelector<HTMLElement>(".nav-scroll");

    const release = () => {
      root.style.transition = "";
      root.style.transform = "";
      root.style.opacity = "";
      root.classList.remove("nav-player-settle");
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const target = touch.target as Element | null;
      if (target?.closest("[data-own-drag]")) return;
      const pane = scroller();
      if (pane && pane.scrollTop > 0) return;

      tracking = true;
      engaged = false;
      travelled = 0;
      startY = touch.clientY;
      startX = touch.clientX;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const touch = e.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;

      if (!engaged) {
        // Upward, or more sideways than down: not ours. Deciding once and
        // staying decided is what keeps a seek from turning into a dismissal
        // halfway through.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          tracking = false;
          return;
        }
        if (dy < ENGAGE_AT) return;
        const pane = scroller();
        if (pane && pane.scrollTop > 0) {
          tracking = false;
          return;
        }
        engaged = true;
        root.classList.remove("nav-player-settle");
        root.style.transition = "none";
      }

      e.preventDefault();
      travelled = dy;
      root.style.transform = `translateY(${dy}px)`;
      root.style.opacity = String(Math.max(0.35, 1 - dy / root.clientHeight));
    };

    const onEnd = () => {
      if (!tracking) return;
      const wasEngaged = engaged;
      tracking = false;
      engaged = false;
      if (!wasEngaged) {
        root.style.transition = "";
        return;
      }

      root.classList.add("nav-player-settle");
      if (travelled > root.clientHeight * DISMISS_FRACTION) {
        haptic.tap();
        root.style.transform = `translateY(${root.clientHeight}px)`;
        root.style.opacity = "0";
        // Unmounting on the transition rather than a guessed delay would be
        // better, except a cancelled transition never fires one and the
        // player would stay stuck offscreen.
        window.setTimeout(() => closeRef.current(), 200);
        return;
      }
      root.style.transform = "";
      root.style.opacity = "";
    };

    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onEnd);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
      release();
    };
  }, [rootRef, ready]);
}

// --- Transport ---------------------------------------------------------------

function TransportButton({
  icon: Icon,
  label,
  size,
  bright,
  on,
  badge,
  onClick,
}: {
  icon: (props: { size?: number }) => React.ReactNode;
  label: string;
  size: number;
  bright?: boolean;
  on?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      className="nav-press"
      aria-label={label}
      aria-pressed={on}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      style={{
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        position: "relative",
        color: on
          ? "var(--color-nav-action)"
          : bright
            ? "#fff"
            : "rgba(255,255,255,.6)",
      }}
    >
      <Icon size={size === 70 ? 26 : 21} />
      {badge ? (
        <span
          style={{
            position: "absolute",
            right: 9,
            bottom: 9,
            fontSize: 8.5,
            fontWeight: 700,
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The scrubber.
 *
 * While a finger is down the thumb follows it and the clock reads the dragged
 * position, but the audio is only told where to go on release: seeking on
 * every pointermove makes a proxied stream re-request a byte range dozens of
 * times across one drag.
 */
function Scrubber({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const at = (clientX: number): number => {
    const rail = railRef.current;
    if (!rail || duration <= 0) return 0;
    const box = rail.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return ratio * duration;
  };

  const shown = dragging ?? position;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  return (
    <div style={{ padding: "16px 18px 0" }}>
      <div
        ref={railRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(at(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragging == null) return;
          setDragging(at(e.clientX));
        }}
        onPointerUp={(e) => {
          if (dragging != null) {
            onSeek(at(e.clientX));
            haptic.select();
          }
          setDragging(null);
        }}
        onPointerCancel={() => setDragging(null)}
        // The player watches for a downward drag to dismiss itself; the rail
        // and the queue's lift handle are the two places a vertical drag means
        // something else, and this marks them so it lets go.
        data-own-drag
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSeek(Math.max(0, position - 10));
          if (e.key === "ArrowRight") onSeek(Math.min(duration, position + 10));
        }}
        // A 4px rail with a 44px hit area around it.
        style={{ padding: "20px 0", cursor: "pointer", touchAction: "none" }}
      >
        <div
          style={{
            position: "relative",
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,.13)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: `${pct}%`,
              borderRadius: 2,
              background: "var(--color-nav-action)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: `${pct}%`,
              width: 12,
              height: 12,
              marginTop: -6,
              marginLeft: -6,
              borderRadius: 6,
              background: "var(--color-nav-action)",
              transform: dragging != null ? "scale(1.25)" : undefined,
              transition: "transform var(--dur-tap) var(--ease)",
            }}
          />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10.5,
          color: "rgba(255,255,255,.45)",
          marginTop: -12,
        }}
      >
        <span>{formatDuration(shown)}</span>
        <span>{formatRemaining(shown, duration)}</span>
      </div>
    </div>
  );
}

// --- Panes -------------------------------------------------------------------

/** The pill row at the bottom. The Queue segment is what pulses when something lands in it. */
function Segments({
  pane,
  onSelect,
  queueCount,
  hasLyrics,
}: {
  pane: Pane;
  onSelect: (pane: Pane) => void;
  queueCount: number;
  hasLyrics: boolean;
}) {
  // Queueing a track changes nothing on screen unless the queue is already
  // open, so the segment itself acknowledges it.
  const [pulse, setPulse] = useState(false);
  const previous = useRef(queueCount);
  useEffect(() => {
    if (queueCount > previous.current) setPulse(true);
    previous.current = queueCount;
  }, [queueCount]);

  const options: { key: Pane; label: string }[] = [
    { key: "player", label: "Player" },
    ...(hasLyrics ? [{ key: "lyrics" as Pane, label: "Lyrics" }] : []),
    { key: "queue", label: `Up next · ${queueCount}` },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        justifyContent: "center",
        padding: "8px 14px 12px",
        flex: "none",
      }}
    >
      {options.map((option) => {
        const active = pane === option.key;
        return (
          <button
            key={option.key}
            className={`nav-press ${pulse && option.key === "queue" ? "nav-pulse" : ""}`}
            onAnimationEnd={() => setPulse(false)}
            data-segment={option.key}
            aria-pressed={active}
            onClick={() => {
              haptic.select();
              onSelect(option.key);
            }}
            style={{
              height: 30,
              padding: "0 14px",
              borderRadius: 15,
              fontSize: 11.5,
              fontWeight: 600,
              background: active ? "rgba(255,255,255,.1)" : "transparent",
              color: active ? "#fff" : "rgba(255,255,255,.45)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Lyrics. A timed file scrolls itself and every line is a seek target; a plain
 * paste is a page of text and stays still, because scrolling text nobody
 * timed would just be guessing.
 */
function LyricsPane({
  track,
  position,
  onSeek,
}: {
  track: Track;
  position: number;
  onSeek: (seconds: number) => void;
}) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  const activeRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    let live = true;
    setState("loading");
    api
      .getLyrics(track.id)
      .then((raw) => {
        if (!live) return;
        const parsed = parseLyrics(raw);
        setLyrics(parsed);
        setState(parsed ? "ready" : "none");
      })
      .catch(() => live && setState("none"));
    return () => {
      live = false;
    };
  }, [track.id]);

  const active = useMemo(
    () =>
      lyrics?.kind === "timed" ? activeLineAt(lyrics.lines, position) : -1,
    [lyrics, position]
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  return (
    <div className="nav-scroll" style={{ flex: 1, minHeight: 0, padding: "10px 22px" }}>
      {state === "loading" ? (
        <p style={{ fontSize: 12.5, color: "rgba(255,255,255,.4)" }}>Loading…</p>
      ) : state === "none" || !lyrics ? (
        <p style={{ fontSize: 12.5, color: "rgba(255,255,255,.4)", lineHeight: 1.6 }}>
          No lyrics for this one. Add them from the track&rsquo;s Edit details.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {lyrics.lines.map((line, i) => {
            const on = i === active;
            const timed = lyrics.kind === "timed";
            return (
              <p
                key={i}
                ref={on ? activeRef : undefined}
                onClick={() => {
                  if (timed && line.at != null) {
                    haptic.select();
                    onSeek(line.at);
                  }
                }}
                style={{
                  margin: 0,
                  fontSize: on || !timed ? 15 : 12.5,
                  lineHeight: 1.3,
                  color: !timed
                    ? "rgba(255,255,255,.8)"
                    : on
                      ? "#fff"
                      : "rgba(255,255,255,.28)",
                  transition: "color var(--dur-state) var(--ease)",
                  cursor: timed ? "pointer" : undefined,
                }}
              >
                {line.text || " "}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The queue, in three parts: what is playing, what was explicitly queued, and
 * what the source will hand over once that runs out. The middle section is
 * the only one that can be reordered — the third is a view of the context and
 * dragging inside it would be editing a playlist by accident.
 *
 * Rows lift on a long press, and every move is also in the row's own menu,
 * because a drag with no alternative is a control nobody with a tremor, a
 * screen reader or a mouse can reach.
 */
function QueuePane({
  current,
  upNext,
  contextNext,
  contextLabel,
  onRemove,
  onMove,
  onClear,
  onMenu,
}: {
  current: Track;
  upNext: Track[];
  contextNext: Track[];
  contextLabel: string | null;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onClear: () => void;
  onMenu: (track: Track) => void;
}) {
  const [lifted, setLifted] = useState<number | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);

  // While a row is lifted the pointer position decides which slot it is over;
  // the move is applied as it crosses each neighbour so the list under the
  // finger is always the list that will be committed.
  const dragTo = useCallback(
    (clientY: number, from: number) => {
      const container = rowsRef.current;
      if (!container) return;
      const rows = Array.from(container.children) as HTMLElement[];
      const to = rows.findIndex((row) => {
        const box = row.getBoundingClientRect();
        return clientY < box.top + box.height / 2;
      });
      const target = to === -1 ? rows.length - 1 : Math.max(0, to);
      if (target !== from) {
        onMove(from, target);
        setLifted(target);
        haptic.select();
      }
    },
    [onMove]
  );

  return (
    <div className="nav-scroll" style={{ flex: 1, minHeight: 0, padding: "4px 14px" }}>
      <QueueHeading label="Now playing" />
      <QueueRow track={current} playing onMenu={() => onMenu(current)} />

      {upNext.length > 0 ? (
        <>
          <QueueHeading
            label="Next in queue"
            action="Clear"
            onAction={() => {
              haptic.warning();
              onClear();
            }}
          />
          <div
            ref={rowsRef}
            onPointerMove={(e) => {
              if (lifted == null) return;
              e.preventDefault();
              dragTo(e.clientY, lifted);
            }}
            onPointerUp={() => setLifted(null)}
            onPointerCancel={() => setLifted(null)}
            style={{ touchAction: lifted == null ? undefined : "none" }}
          >
            {upNext.map((track, i) => (
              <QueueRow
                key={`${track.id}-${i}`}
                track={track}
                lifted={lifted === i}
                onLift={() => setLifted(i)}
                onMenu={() => onMenu(track)}
                moves={{
                  isFirst: i === 0,
                  isLast: i === upNext.length - 1,
                  toTop: () => onMove(i, 0),
                  up: () => onMove(i, i - 1),
                  down: () => onMove(i, i + 1),
                  remove: () => onRemove(i),
                }}
              />
            ))}
          </div>
        </>
      ) : null}

      {contextNext.length > 0 ? (
        <>
          <QueueHeading label={`Next from: ${contextLabel ?? "here"}`} />
          {contextNext.slice(0, 40).map((track, i) => (
            <QueueRow
              key={`${track.id}-ctx-${i}`}
              track={track}
              onMenu={() => onMenu(track)}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function QueueHeading({
  label,
  action,
  onAction,
}: {
  label: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        marginTop: 16,
        marginBottom: 6,
      }}
    >
      <span
        className="nav-clip"
        style={{ fontSize: 10.5, color: "rgba(255,255,255,.42)", letterSpacing: ".04em" }}
      >
        {label}
      </span>
      {action ? (
        <button
          className="nav-press"
          onClick={onAction}
          style={{
            marginLeft: "auto",
            minHeight: 44,
            paddingLeft: 12,
            fontSize: 11,
            color: "rgba(255,255,255,.55)",
          }}
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}

function QueueRow({
  track,
  playing,
  lifted,
  onLift,
  onMenu,
  moves,
}: {
  track: Track;
  playing?: boolean;
  lifted?: boolean;
  onLift?: () => void;
  onMenu: () => void;
  /** The reorder actions, when this row is one that can be reordered. */
  moves?: QueueMoves;
}) {
  const [movesOpen, setMovesOpen] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 52,
        borderRadius: 10,
        background: lifted ? "rgba(255,255,255,.07)" : undefined,
        transform: lifted ? "scale(1.02)" : undefined,
        transition: "transform var(--dur-state) var(--ease)",
      }}
    >
      {moves ? (
        <button
          className="nav-press"
          aria-label="Reorder — long press to lift, or use the menu"
          data-own-drag
          onPointerDown={onLift}
          onClick={() => setMovesOpen(true)}
          style={{
            width: 28,
            height: 44,
            display: "grid",
            placeItems: "center",
            color: "rgba(255,255,255,.22)",
            touchAction: "none",
            flex: "none",
          }}
        >
          <DragIcon size={14} />
        </button>
      ) : null}

      <Cover trackId={track.id} hasCover={track.has_cover} size={36} radius={8} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="nav-clip"
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: playing ? "var(--color-nav-action)" : "#fff",
          }}
        >
          {trackTitle(track)}
        </div>
        <div
          className="nav-clip"
          style={{ fontSize: 10.5, color: "rgba(255,255,255,.5)", marginTop: 1 }}
        >
          {trackArtist(track)}
        </div>
      </div>

      <span style={{ fontSize: 10.5, color: "rgba(255,255,255,.32)", flex: "none" }}>
        {formatDuration(track.duration_seconds)}
      </span>

      <button
        className="nav-press"
        aria-label="Track options"
        onClick={onMenu}
        style={{
          width: 34,
          height: 44,
          display: "grid",
          placeItems: "center",
          color: "rgba(255,255,255,.45)",
          flex: "none",
        }}
      >
        <DotsIcon size={15} />
      </button>

      {moves ? (
        <Sheet
          open={movesOpen}
          onClose={() => setMovesOpen(false)}
          title={trackTitle(track)}
        >
          <SheetItem
            icon={ArrowUpIcon}
            label="Move to top"
            disabled={moves.isFirst}
            onClick={() => {
              moves.toTop();
              setMovesOpen(false);
            }}
          />
          <SheetItem
            icon={ChevronUpIcon}
            label="Move up"
            disabled={moves.isFirst}
            onClick={() => {
              moves.up();
              setMovesOpen(false);
            }}
          />
          <SheetItem
            icon={ChevronDownIcon}
            label="Move down"
            disabled={moves.isLast}
            onClick={() => {
              moves.down();
              setMovesOpen(false);
            }}
          />
          <SheetItem
            icon={TrashIcon}
            label="Remove from queue"
            destructive
            onClick={() => {
              moves.remove();
              setMovesOpen(false);
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

/** What a queued row can do to its own position. */
interface QueueMoves {
  isFirst: boolean;
  isLast: boolean;
  toTop: () => void;
  up: () => void;
  down: () => void;
  remove: () => void;
}
