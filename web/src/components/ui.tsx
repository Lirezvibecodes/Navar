import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { haptic } from "../telegram";
import type { IconProps } from "../icons";

/**
 * The small shared pieces: the scroll container every screen sits in, the
 * chips, the round glass buttons, the section headers and the empty states.
 *
 * They live together because each is a handful of lines whose only job is to
 * keep one measurement identical across screens — the 44px target floor, the
 * 29px pill radius, the padding that clears the bottom furniture. Split across
 * eight files they would be harder to keep in step, not easier.
 */

// --- Layout ------------------------------------------------------------------

/**
 * A scrollable screen.
 *
 * The padding is the whole reason this exists. The bars at both ends of the
 * screen float over the content rather than boxing it in, so this container
 * runs edge to edge and reserves the room they occupy itself — otherwise a
 * list's first and last rows sit behind glass.
 *
 * Three things stack over it: the top bar, and at the bottom the nav and the
 * Now Playing bar once anything is playing. Every height is a custom property
 * written by the component that owns it, so the padding follows a bar
 * appearing without anybody passing a prop down.
 *
 * The device inset is deliberately not in the sum. --nav-bottomnav-h is the
 * nav's own offsetHeight, and the nav already carries the gesture bar in its
 * own padding — adding --tg-safe-bottom here counted it twice and left a strip
 * of dead space under the last row of every list.
 */
export function Screen({
  children,
  className = "",
  gap = 0,
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
}) {
  return (
    <div
      className={`nav-scroll nav-screen ${className}`}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap,
        padding: "0 14px",
        paddingTop: "calc(var(--nav-topbar-h) + var(--nav-top-inset) + 8px)",
        paddingBottom:
          "calc(var(--nav-bottomnav-h) + var(--nav-nowplaying-h) + 16px)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * A run-in header above a shelf or a list. More space above than below, so the
 * heading belongs to what follows it rather than floating between two blocks.
 */
export function SectionHeader({
  title,
  action,
  onAction,
  spaceAbove = 22,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  spaceAbove?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: spaceAbove,
        marginBottom: 9,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>
        {title}
      </span>
      {action ? (
        <button
          className="nav-press"
          onClick={() => {
            haptic.tap();
            onAction?.();
          }}
          style={{
            color: "var(--color-nav-action)",
            fontSize: 11.5,
            fontWeight: 600,
            minHeight: 44,
            paddingLeft: 12,
            marginRight: -2,
          }}
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}

// --- Controls ----------------------------------------------------------------

/**
 * A 34px round glass button — the top bar's search and overflow, the player's
 * back chevron. The visible circle is 34px and the hit area is 44px, which is
 * the only way to honour the target floor without a row of fat buttons.
 */
export function RoundButton({
  icon: Icon,
  label,
  onClick,
  size = 34,
  tone = "glass",
  className = "",
  style,
}: {
  icon: (props: IconProps) => ReactNode;
  label: string;
  onClick: () => void;
  size?: number;
  tone?: "glass" | "action" | "bare";
  className?: string;
  style?: React.CSSProperties;
}) {
  const pad = Math.max(0, (44 - size) / 2);
  return (
    <button
      aria-label={label}
      className={`nav-press ${className}`}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: size,
        height: size,
        margin: -pad,
        padding: pad,
        boxSizing: "content-box",
        backgroundClip: "content-box",
        borderRadius: "50%",
        color: tone === "action" ? "#0A0A0A" : "rgba(255,255,255,.72)",
        background: tone === "action" ? "var(--color-nav-action)" : undefined,
        ...style,
      }}
    >
      <span
        className={tone === "glass" ? "nav-glass" : undefined}
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: "50%",
          pointerEvents: "none",
        }}
      />
      <Icon size={Math.round(size * 0.47)} style={{ position: "relative" }} />
    </button>
  );
}

/**
 * The filter chips: `All · 142`, `Unsorted · 12`, `Albums`, `Artists`. The
 * active one is lime and the rest are glass, which is the same contrast the
 * bottom nav uses, so "where am I" reads the same everywhere.
 */
export function Chip({
  label,
  count,
  active,
  onClick,
  icon: Icon,
  className = "",
  ...rest
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  /** A chip that goes somewhere rather than filtering carries its own glyph. */
  icon?: (props: IconProps) => ReactNode;
  className?: string;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "className" | "style"
>) {
  return (
    <button
      {...rest}
      className={`nav-press ${active ? "" : "nav-glass"} ${className}`}
      aria-pressed={active}
      onClick={() => {
        haptic.select();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: Icon ? "0 13px 0 11px" : "0 13px",
        borderRadius: 16,
        flex: "none",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        color: active ? "#0A0A0A" : "rgba(255,255,255,.72)",
        background: active ? "var(--color-nav-action)" : undefined,
        boxShadow: active
          ? "0 6px 22px rgba(223,252,142,.42), 0 2px 8px rgba(223,252,142,.3)"
          : undefined,
      }}
    >
      {Icon ? <Icon size={14} style={{ flex: "none" }} /> : null}
      <span>
        {label}
        {count == null ? null : (
          <span style={{ opacity: active ? 0.55 : 0.5 }}> · {count}</span>
        )}
      </span>
    </button>
  );
}

// --- Fields ------------------------------------------------------------------

/**
 * A single-line text input.
 *
 * Five screens spelled this out inline and arrived at four different radii —
 * 12, 19, 20 and 22 — for what is the same control every time. The radius is
 * now derived rather than chosen: a single-line field is a pill, because every
 * other single-line control in the app is one.
 *
 * Focus lives in .nav-field. Each of these inputs used to carry a bare
 * `outline: "none"`, which on a phone looks like nothing and on a keyboard
 * means the field cannot be found at all.
 */
export function TextField({
  value,
  onChange,
  placeholder,
  height = 40,
  fontSize = 13,
  maxLength,
  onEnter,
  autoCorrect = true,
  ref,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  height?: number;
  fontSize?: number;
  maxLength?: number;
  onEnter?: () => void;
  /** Off for handles and search terms: a phone capitalising a username is
   *  correcting something that has exactly one right spelling. */
  autoCorrect?: boolean;
  ref?: React.Ref<HTMLInputElement>;
  style?: React.CSSProperties;
}) {
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={
        onEnter
          ? (e) => {
              if (e.key === "Enter") onEnter();
            }
          : undefined
      }
      placeholder={placeholder}
      maxLength={maxLength}
      autoCapitalize={autoCorrect ? undefined : "none"}
      autoCorrect={autoCorrect ? undefined : "off"}
      spellCheck={autoCorrect ? undefined : false}
      className="nav-glass nav-field"
      style={{
        flex: 1,
        minWidth: 0,
        height,
        borderRadius: height / 2,
        padding: `0 ${Math.round(height * 0.36)}px`,
        fontSize,
        ...style,
      }}
    />
  );
}

/** The same field, for something long enough to wrap. Not a pill: a rounded
 *  rectangle is the only shape that survives four lines of text. */
export function TextArea({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 4,
  ref,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows}
      className="nav-glass nav-field"
      style={{
        width: "100%",
        borderRadius: 18,
        padding: "11px 14px",
        fontSize: 13.5,
        lineHeight: 1.45,
        resize: "none",
      }}
    />
  );
}

/**
 * The chips scroll, and a scroller clips. .nav-shelf-bleed is the room the
 * active chip's glow needs on all four sides, given back to the layout as
 * negative margin so the row still sits where it looks like it sits.
 */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="nav-shelf nav-shelf-bleed" style={{ gap: 7 }}>
      {children}
    </div>
  );
}

/**
 * The lime action button — `Play all`, `Save`, `Add`. Full width by default
 * because that is how it appears in every screen that has one.
 */
export function ActionButton({
  children,
  onClick,
  icon: Icon,
  height = 38,
  grow = true,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: (props: IconProps) => ReactNode;
  height?: number;
  grow?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className="nav-press"
      disabled={disabled}
      onClick={() => {
        haptic.press();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        flex: grow ? 1 : "none",
        height,
        padding: grow ? undefined : "0 16px",
        borderRadius: height / 2,
        background: "var(--color-nav-action)",
        color: "#0A0A0A",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        opacity: disabled ? 0.4 : 1,
        boxShadow: disabled ? undefined : "0 6px 20px rgba(223,252,142,.2)",
      }}
    >
      {Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}

/** The glass twin of ActionButton — shuffle next to Play all, Cancel next to Save. */
export function GhostButton({
  children,
  onClick,
  icon: Icon,
  label,
  width,
  height = 38,
  disabled,
}: {
  children?: ReactNode;
  onClick: () => void;
  icon?: (props: IconProps) => ReactNode;
  label?: string;
  width?: number;
  height?: number;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      className="nav-press nav-glass"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        flex: width ? "none" : 1,
        width,
        height,
        borderRadius: height / 2,
        color: "rgba(255,255,255,.82)",
        fontSize: 13,
        fontWeight: 600,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  );
}

/**
 * A labelled switch.
 *
 * The entire row is the control, because a 30px track cannot carry a 44px hit
 * area on its own and putting a second tappable thing beside it would make the
 * label look like it did something different from the switch. The knob is dark
 * when the switch is on, since the track it sits on is then the pale accent.
 */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className="nav-press"
      onClick={() => {
        haptic.select();
        onChange(!checked);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 52,
        textAlign: "left",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {label}
        </span>
        {hint ? (
          <span
            style={{
              display: "block",
              fontSize: 11.5,
              lineHeight: 1.35,
              color: "var(--color-nav-muted)",
              marginTop: 3,
            }}
          >
            {hint}
          </span>
        ) : null}
      </span>
      <span
        style={{
          position: "relative",
          flex: "none",
          width: 44,
          height: 26,
          borderRadius: 13,
          background: checked
            ? "var(--color-nav-action)"
            : "rgba(255,255,255,.14)",
          transition: "background var(--dur-state) var(--ease)",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: checked ? "#0b0d10" : "rgba(255,255,255,.62)",
            transition:
              "left var(--dur-state) var(--ease), background var(--dur-state) var(--ease)",
          }}
        />
      </span>
    </button>
  );
}

// --- States ------------------------------------------------------------------

/**
 * An empty section. Says what would be here and how to put something in it —
 * an empty state that only says "Nothing here" has wasted the one moment the
 * user was looking for instructions.
 */
export function Empty({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div
      className="nav-fade"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 7,
        padding: "34px 24px",
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
        {title}
      </span>
      {body ? (
        <span
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--color-nav-muted)",
            maxWidth: 268,
          }}
        >
          {body}
        </span>
      ) : null}
      {action ? (
        <div style={{ marginTop: 8 }}>
          <ActionButton grow={false} onClick={() => onAction?.()}>
            {action}
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The loading state: the shape of the rows that are coming, not a spinner.
 * Breathing rather than sweeping — a shimmer keyframe across a full screen of
 * placeholders is the single most expensive thing a phone can be asked to
 * paint while it is also opening a websocket and decoding audio.
 */
export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="nav-row-in"
          style={
            {
              "--i": i,
              display: "flex",
              alignItems: "center",
              gap: 11,
              height: 52,
              opacity: 0.5,
            } as React.CSSProperties
          }
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 9,
              flex: "none",
              background: "rgba(255,255,255,.06)",
            }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                height: 9,
                width: `${52 + ((i * 13) % 34)}%`,
                borderRadius: 5,
                background: "rgba(255,255,255,.07)",
              }}
            />
            <div
              style={{
                height: 7,
                width: `${28 + ((i * 9) % 20)}%`,
                borderRadius: 4,
                background: "rgba(255,255,255,.045)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Overlays ----------------------------------------------------------------

/**
 * Anything that has to sit above the whole app, rendered into `<body>`.
 *
 * z-index alone was never going to be enough here. Every screen is wrapped in
 * the view-stack animation, and an element with an animation on `opacity` or
 * `transform` is a stacking context for as long as that animation is in
 * effect — which, with `animation-fill-mode: both`, is forever. So a sheet at
 * z-index 70 rendered inside a screen was not competing with the bottom nav at
 * all: it was sealed inside a container that the nav's own z-index of 30 paints
 * straight over. That is why the lower half of every menu was untappable, and
 * why the Crate's selection bar looked like it had no actions — it was there,
 * behind the navbar, the whole time.
 *
 * Leaving the DOM is the fix. Nothing inside a screen can be raised above the
 * furniture without also raising the screen, and the screen has to stay
 * underneath: content passing behind the glass is the whole layout.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [host] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div")
  );

  useEffect(() => {
    if (!host) return;
    document.body.appendChild(host);
    return () => {
      host.remove();
    };
  }, [host]);

  return host ? createPortal(children, host) : null;
}

// --- Sheets ------------------------------------------------------------------

/**
 * The bottom sheet behind every `⋯`.
 *
 * A sheet rather than a popover because the menus here are lists of five to
 * nine actions on a phone held in one hand, and a popover anchored to a 30px
 * button either covers the row it belongs to or opens somewhere the thumb
 * cannot reach.
 *
 * It animates out as well as in, which is why the open state is held here
 * rather than by the caller: unmounting on close would make it disappear.
 */
/** Matches the exit transitions below — --dur-state (200ms) plus a frame, so
 *  the sheet unmounts after it has finished leaving rather than during. */
const SHEET_EXIT_MS = 220;

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const closing = mounted && !open;

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), SHEET_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <Portal>
      {/* Sized from the top to the height Telegram is actually showing rather
          than pinned inset: 0. A fixed element resolves against the layout
          viewport, which on Android does not shrink when the keyboard opens —
          so a sheet justified to flex-end was laying its content out behind
          the keyboard. --tg-viewport-height tracks the visual viewport, so the
          sheet shrinks with it and its contents stay reachable. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "var(--tg-viewport-height, 100%)",
          zIndex: "var(--z-sheet)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        <button
          aria-label="Close"
          onClick={onClose}
          className="nav-fade"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            opacity: closing ? 0 : 1,
            transition: "opacity var(--dur-state) var(--ease)",
          }}
        />
        <div
          role="dialog"
          aria-modal="true"
          className={`nav-sheet ${closing ? "" : "nav-rise"}`}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            // A sheet with nine items and a text field can be taller than the
            // room above the fold. Capping it against the top inset and letting
            // the items scroll is what keeps the last one reachable — it used
            // to run off the top of the screen instead.
            maxHeight: "calc(100% - var(--nav-top-inset) - 44px)",
            padding: "10px 8px",
            // The device inset plus a thumb's worth of room. The nav and the
            // player are underneath this sheet now rather than on top of it,
            // so nothing here has to dodge them.
            paddingBottom: "calc(var(--tg-safe-bottom) + 14px)",
            transform: closing ? "translateY(100%)" : undefined,
            transition: closing
              ? "transform var(--dur-state) var(--ease-in)"
              : undefined,
          }}
        >
          <div
            style={{
              width: 38,
              height: 4,
              borderRadius: 2,
              flex: "none",
              background: "var(--color-nav-ghost)",
              margin: "2px auto 10px",
            }}
          />
          {title ? (
            <div
              className="nav-clip"
              style={{
                flex: "none",
                fontSize: 11.5,
                color: "var(--color-nav-muted)",
                padding: "0 14px 8px",
              }}
            >
              {title}
            </div>
          ) : null}
          <div className="nav-scroll" style={{ minHeight: 0 }}>
            {children}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/**
 * A rule between groups of sheet items.
 *
 * The only thing standing between "remove this from the playlist" and "delete
 * this from your library forever" used to be 46px of nothing, which is the
 * distance a thumb travels by accident. The two are different kinds of act and
 * now look it: they are in different groups, they carry different glyphs, and
 * only the second one is red.
 */
export function SheetDivider() {
  return (
    <div
      role="separator"
      style={{
        height: 1,
        margin: "7px 14px",
        background: "rgba(255,255,255,.09)",
      }}
    />
  );
}

/** One line in a sheet. Destructive actions are the only coloured ones. */
export function SheetItem({
  icon: Icon,
  label,
  onClick,
  destructive,
  disabled,
}: {
  icon: (props: IconProps) => ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className="nav-press"
      disabled={disabled}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        width: "100%",
        minHeight: 46,
        padding: "0 14px",
        borderRadius: 12,
        fontSize: 13.5,
        textAlign: "left",
        color: destructive ? "var(--color-nav-danger)" : "rgba(255,255,255,.9)",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Icon size={17} style={{ opacity: 0.8, flex: "none" }} />
      <span className="nav-clip">{label}</span>
    </button>
  );
}

// --- Gestures ----------------------------------------------------------------

/**
 * Long-press, with the tap still working.
 *
 * Used for entering selection mode and for picking up a queue row. Every
 * long-press in the app has a visible alternative somewhere — a Select button,
 * a Move up in the overflow menu — because a hidden gesture is not a control.
 * This exists to make the shortcut available, not to be the only way in.
 */
export function useLongPress(onLongPress: () => void, ms = 420) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    onPointerDown: () => {
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        haptic.press();
        onLongPress();
      }, ms);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    /** True when the press already fired, so the click handler can stand down. */
    consumed: () => fired.current,
  };
}
