import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { haptic } from "../telegram";
import { ArrowRightIcon, type IconProps } from "../icons";
import { backdropCss, type Palette } from "../lib/palette";

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
// Kept outside React, keyed by screen identity, so a screen that remounts on
// every navigation (every push bumps the stack's key) can still put the
// reader back where they left off instead of snapping to the top.
const lastScroll = new Map<string, number>();

export function Screen({
  children,
  className = "",
  gap = 0,
  scrollKey,
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
  /** Restores and remembers scrollTop across the remount a navigation causes. */
  scrollKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (scrollKey && ref.current) ref.current.scrollTop = lastScroll.get(scrollKey) ?? 0;
    // Deliberately re-runs only when the key itself changes, not on every
    // render — this is a one-time restore on mount, not a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  return (
    <div
      ref={ref}
      className={`nav-scroll nav-screen ${className}`}
      onScroll={
        scrollKey ? () => lastScroll.set(scrollKey, ref.current?.scrollTop ?? 0) : undefined
      }
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
 * The tint a playlist or album screen wears, taken from its own cover.
 *
 * Fixed to the viewport rather than scrolled with the list, the same way the
 * app's own static wash (`.nav-screen-bg`) is. It carries no z-index of its
 * own, and `.nav-screen` is deliberately given `position: relative` so the
 * screen's content shares that same auto-z-index stacking group rather than
 * sitting in the plain in-flow layer beneath it — within a shared group, DOM
 * order settles the tie, and this backdrop is mounted first. No fade: the
 * screen it sits behind is freshly mounted on every visit, unlike the player,
 * which swaps tracks in place and needs one to avoid a cut.
 */
export function CoverBackdrop({ palette }: { palette: Palette | null }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        background: backdropCss(palette),
      }}
    />
  );
}

/**
 * A run-in header above a shelf or a list. More space above than below, so the
 * heading belongs to what follows it rather than floating between two blocks.
 *
 * 16.5px, not 13. At 13 the heading was the same size as the row captions under
 * it, so a screen with four shelves read as one continuous grey column and you
 * had to find the section breaks by looking at the gaps. It is one of exactly
 * two heading treatments in the app — this and the uppercase eyebrow in TopBar.
 * Its trailing action stays small: the size difference between a heading and
 * its affordance is what says which one is the label.
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
      <span
        style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: "-0.015em" }}
      >
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

/**
 * The other heading — the small uppercase one. It names a kind of thing rather
 * than a section of content: what sort of screen you are on in the top bar,
 * what a list in the player's sheet is. There were three heading styles in the
 * app before this was shared; the player had invented a fourth locally.
 */
export const EYEBROW: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--color-nav-muted)",
};

/**
 * A number, set in the pixel display face.
 *
 * Digits only, and never a whole phrase: Pixelify Sans renders lowercase words
 * at 11px as a smudge. `<Num>142</Num> tracks` is the shape — the number wears
 * the accent face and the word beside it stays in the reading face. Tabular
 * figures because most of these sit in a column or count up live, and figures
 * that change width make the line twitch.
 */
export function Num({ children }: { children: ReactNode }) {
  return <span className="nav-numeral">{children}</span>;
}

/**
 * `12 tracks` with the 12 in the pixel face — the shape most counts in the app
 * take. It exists so that the split between the digits and the word is made
 * once rather than at every call site, and so that nothing is tempted to put
 * the whole phrase in the display face.
 */
export function Counted({
  count,
  one,
  many = `${one}s`,
}: {
  count: number;
  one: string;
  many?: string;
}) {
  return (
    <>
      <Num>{count}</Num> {count === 1 ? one : many}
    </>
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
          ? "0 6px 22px rgba(var(--color-nav-action-rgb),.42), 0 2px 8px rgba(var(--color-nav-action-rgb),.3)"
          : undefined,
      }}
    >
      {Icon ? <Icon size={14} style={{ flex: "none" }} /> : null}
      <span>
        {label}
        {count == null ? null : (
          <span style={{ opacity: active ? 0.55 : 0.5 }}>
            {" · "}
            <Num>{count}</Num>
          </span>
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
 * The action button — `Play all`, `Save`, `Add`. Full width by default because
 * that is how it appears in every screen that has one.
 *
 * Two shapes, and which one to use is a rule rather than a preference:
 *
 * - `solid` — a flat lime pill. For compact actions living inside something
 *   else: a row's `Add`, a bar's `Add to…`, a sheet's confirm. There are
 *   several of these on screen at once and they must not each shout.
 * - `disc` — glass pill with a lime disc at its head, the shape the bottom
 *   nav's active tab already wears. For the one hero action a screen has:
 *   `Play all`, an empty state's way out, the deck's Resume. One per screen,
 *   or the rule is broken and neither is primary any more.
 *
 * `solid` is the default so nothing that already existed moves.
 */
export function ActionButton({
  children,
  onClick,
  icon: Icon,
  height = 38,
  grow = true,
  variant = "solid",
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: (props: IconProps) => ReactNode;
  height?: number;
  grow?: boolean;
  variant?: "solid" | "disc";
  disabled?: boolean;
}) {
  const disc = variant === "disc";
  // The disc is inset from the capsule by the same 3px the bottom nav uses, and
  // the label's room on the far side matches it plus the optical weight of a
  // filled circle, so the text sits in the middle of what is left rather than
  // in the middle of the button.
  const discSize = height - 6;

  return (
    <button
      className={`nav-press ${disc ? "nav-glass" : ""}`}
      disabled={disabled}
      onClick={() => {
        haptic.press();
        onClick();
      }}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: disc ? 0 : 7,
        flex: grow ? 1 : "none",
        height,
        padding: disc ? "3px" : grow ? undefined : "0 16px",
        borderRadius: height / 2,
        background: disc ? undefined : "var(--color-nav-action)",
        color: disc ? "#fff" : "#0A0A0A",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        opacity: disabled ? 0.4 : 1,
        boxShadow: disabled || disc ? undefined : "0 6px 20px rgba(var(--color-nav-action-rgb),.2)",
      }}
    >
      {disc ? (
        <>
          <span
            style={{
              display: "grid",
              placeItems: "center",
              flex: "none",
              width: discSize,
              height: discSize,
              borderRadius: "50%",
              background: "var(--color-nav-action)",
              color: "#0A0A0A",
              boxShadow: "0 6px 18px rgba(var(--color-nav-action-rgb),.34)",
            }}
          >
            {Icon ? <Icon size={Math.round(discSize * 0.42)} /> : null}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              // Balanced against the disc so the label reads centred in the
              // capsule rather than centred in the gap beside it.
              padding: `0 ${Math.round(discSize * 0.4)}px 0 ${Math.round(discSize * 0.3)}px`,
            }}
          >
            {children}
          </span>
        </>
      ) : (
        <>
          {Icon ? <Icon size={14} /> : null}
          {children}
        </>
      )}
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
  actionIcon = ArrowRightIcon,
  onAction,
}: {
  title: string;
  body?: string;
  action?: string;
  /** The glyph inside the disc. Whatever the way out of this empty state is. */
  actionIcon?: (props: IconProps) => ReactNode;
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
        <div style={{ marginTop: 10 }}>
          <ActionButton
            grow={false}
            variant="disc"
            height={44}
            icon={actionIcon}
            onClick={() => onAction?.()}
          >
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

const SWIPE_QUEUE_PX = 44;
const SWIPE_NEXT_PX = 104;

export type SwipeQueueStage = "none" | "queue" | "next";

/**
 * Swipe right on a row to queue it, without needing the ⋯ menu.
 *
 * Two thresholds, one direction: past the first, releasing adds the track to
 * the end of the queue; past the second, releasing plays it next. Both are
 * already reachable from the row's own menu — see TrackMenu — so this is a
 * shortcut layered on an existing, visible action rather than a hidden one.
 *
 * The axis is decided once, in the first ~10px of movement, and never
 * revisited: a vertical scroll that drifts sideways must stay a scroll for
 * its whole gesture, not lock into a swipe partway through it.
 */
export function useSwipeQueue(onQueueLast: () => void, onQueueNext: () => void) {
  const [dragX, setDragX] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const deciding = useRef(false);
  const active = useRef(false);
  const stage = useRef<SwipeQueueStage>("none");

  const stageFor = (dx: number): SwipeQueueStage => {
    if (dx >= SWIPE_NEXT_PX) return "next";
    if (dx >= SWIPE_QUEUE_PX) return "queue";
    return "none";
  };

  const reset = () => {
    start.current = null;
    deciding.current = false;
    active.current = false;
    stage.current = "none";
    setDragX(0);
  };

  return {
    dragX,
    stage: stageFor(dragX),
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
      deciding.current = true;
      active.current = false;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (deciding.current) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        deciding.current = false;
        if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) {
          start.current = null;
          return;
        }
        active.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (!active.current) return;
      e.preventDefault();
      const clamped = Math.max(0, Math.min(dx, SWIPE_NEXT_PX + 24));
      const next = stageFor(clamped);
      if (next !== stage.current) {
        stage.current = next;
        haptic.select();
      }
      setDragX(clamped);
    },
    onPointerUp: () => {
      const finished = stage.current;
      if (finished === "next") onQueueNext();
      else if (finished === "queue") onQueueLast();
      reset();
    },
    onPointerCancel: reset,
    onPointerLeave: () => {
      if (active.current) reset();
    },
    /** True mid-drag, so the tap handler can stand down the same way long-press's does. */
    dragging: () => active.current,
  };
}

const SWIPE_REMOVE_PX = 64;

/**
 * Swipe left on a row to remove it — the queue's version of useSwipeQueue.
 * One threshold, the opposite direction: the track is already queued, so the
 * gesture that adds a track to a queue and the gesture that removes one
 * already in it can never be mistaken for each other.
 */
export function useSwipeRemove(onRemove: () => void) {
  const [dragX, setDragX] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const deciding = useRef(false);
  const active = useRef(false);
  const armed = useRef(false);

  const reset = () => {
    start.current = null;
    deciding.current = false;
    active.current = false;
    armed.current = false;
    setDragX(0);
  };

  return {
    dragX,
    armed: dragX <= -SWIPE_REMOVE_PX,
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
      deciding.current = true;
      active.current = false;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (deciding.current) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        deciding.current = false;
        if (Math.abs(dy) >= Math.abs(dx) || dx >= 0) {
          start.current = null;
          return;
        }
        active.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (!active.current) return;
      e.preventDefault();
      const clamped = Math.min(0, Math.max(dx, -(SWIPE_REMOVE_PX + 24)));
      const next = clamped <= -SWIPE_REMOVE_PX;
      if (next !== armed.current) {
        armed.current = next;
        haptic.select();
      }
      setDragX(clamped);
    },
    onPointerUp: () => {
      const shouldRemove = armed.current;
      reset();
      if (shouldRemove) onRemove();
    },
    onPointerCancel: reset,
    onPointerLeave: () => {
      if (active.current) reset();
    },
    /** True mid-drag, so the tap handler can stand down the same way long-press's does. */
    dragging: () => active.current,
  };
}
