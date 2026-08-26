import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { haptic } from "../telegram";

/**
 * The one place the app tells you something happened.
 *
 * There is a single slot, and a new message replaces whatever is in it — with
 * one exception that matters: a message you might need to act on is never
 * replaced by an informational one. Undo is the app's substitute for
 * confirmation dialogs, so removing a track shows a snackbar instead of asking
 * first; if a passing "Added to Basement" could shove that off the screen, the
 * undo would be gone before the user's hand got there. A failure has the same
 * claim on the slot for the same reason — it is the only account anyone gets
 * of what went wrong. An informational toast arriving during either waits its
 * turn.
 */

type ToastKind = "info" | "error" | "undo";

interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const INFO_MS = 2600;
const ERROR_MS = 6000;
const UNDO_MS = 6000;

/** Everything the server can hand back that is not worth showing a person. */
function readableError(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const message = raw.trim();
  // A bare "Failed to fetch", a status line, or an empty string tells the user
  // nothing that the caller's fallback does not tell them better.
  if (message.length === 0 || message.length > 160) return fallback;
  if (/^(failed to fetch|network ?error|load failed)$/i.test(message)) {
    return fallback;
  }
  return message;
}

interface ToastApi {
  /** A passing confirmation. Replaced freely by the next one. */
  toast: (message: string) => void;
  /**
   * Something did not work. Holds the slot for as long as an undo does, keeps
   * up to three lines of whatever the server said, and falls back to
   * `fallback` when the thrown value has nothing a person could read.
   */
  errorToast: (err: unknown, fallback: string) => void;
  /** A reversible action. Holds the slot until it times out or is used. */
  undoToast: (
    message: string,
    onUndo: () => void,
    actionLabel?: string
  ) => void;
  /** Distance in px to lift the snackbar by — the contextual action bar sets
   *  this while selection mode is open so it does not cover it. */
  setToastLift: (px: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const [lift, setLift] = useState(0);
  const pending = useRef<ToastState | null>(null);
  const nextId = useRef(1);

  const show = useCallback((next: Omit<ToastState, "id">) => {
    setCurrent((existing) => {
      // The exception. Anything else takes the slot immediately.
      if (existing && existing.kind !== "info" && next.kind === "info") {
        pending.current = { ...next, id: nextId.current++ };
        return existing;
      }
      pending.current = null;
      return { ...next, id: nextId.current++ };
    });
  }, []);

  useEffect(() => {
    if (!current) {
      // Whatever was held back while an undo was on screen gets its turn now.
      const queued = pending.current;
      if (queued) {
        pending.current = null;
        setCurrent(queued);
      }
      return;
    }
    const ms =
      current.kind === "undo"
        ? UNDO_MS
        : current.kind === "error"
          ? ERROR_MS
          : INFO_MS;
    const timer = window.setTimeout(() => setCurrent(null), ms);
    return () => window.clearTimeout(timer);
  }, [current]);

  const api = useMemo<ToastApi>(
    () => ({
      toast: (message) => show({ kind: "info", message }),
      errorToast: (err, fallback) => {
        haptic.error();
        show({ kind: "error", message: readableError(err, fallback) });
      },
      undoToast: (message, onUndo, actionLabel = "Undo") =>
        show({ kind: "undo", message, actionLabel, onAction: onUndo }),
      setToastLift: setLift,
    }),
    [show]
  );

  const failed = current?.kind === "error";

  return (
    <Ctx.Provider value={api}>
      {children}
      {current ? (
        // The toast measures its offset from the bottom of the screen, and a
        // fixed element's bottom is the bottom of the *layout* viewport, which
        // Android does not shrink for its own keyboard — so a toast raised
        // above the nav still ended up behind it. This column is the viewport
        // Telegram is actually showing, from the top down, and the toast is
        // simply the last thing in it.
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: "var(--tg-viewport-height, 100%)",
            zIndex: "var(--z-toast)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            pointerEvents: "none",
          }}
        >
          <div
            className="nav-rise"
            role={failed ? "alert" : "status"}
            aria-live={failed ? "assertive" : "polite"}
            style={{
              position: "relative",
              // Clears the bottom furniture plus whatever the contextual action
              // bar has asked for. --nav-bottomnav-h is measured off the live
              // element, and that element already carries the device inset in
              // its own padding — adding --tg-safe-bottom here counted the
              // gesture bar twice and floated the toast clear of the nav.
              margin: `0 14px calc(var(--nav-bottomnav-h) + var(--nav-nowplaying-h) + ${lift}px + 8px)`,
              pointerEvents: "auto",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              minHeight: 44,
              padding: "0 14px",
              borderRadius: 18,
              fontSize: 12.5,
              lineHeight: 1.45,
            }}
          >
            <div
              className="nav-glass"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 18,
                pointerEvents: "none",
              }}
            />
            {/* The icon set is a fixed pixel library with no warning glyph in
                it, and hand-drawing one would leave the app with exactly one
                icon that came from somewhere else. A red rule down the leading
                edge says the same thing in the material the toast is already
                made of. */}
            {failed ? (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 8,
                  bottom: 8,
                  width: 3,
                  borderRadius: "0 3px 3px 0",
                  background: "var(--color-nav-danger)",
                }}
              />
            ) : null}
            <span
              className="nav-clamp-3"
              style={{ position: "relative", flex: 1, padding: "11px 0" }}
            >
              {current.message}
            </span>
            {current.onAction ? (
              <button
                className="nav-press"
                style={{
                  position: "relative",
                  color: "var(--color-nav-action)",
                  fontWeight: 600,
                  fontSize: 12.5,
                  minHeight: 44,
                  paddingLeft: 6,
                  flex: "none",
                }}
                onClick={() => {
                  haptic.tap();
                  current.onAction?.();
                  setCurrent(null);
                }}
              >
                {current.actionLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
