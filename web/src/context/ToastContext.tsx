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
 * one exception that matters: an undo snackbar is never replaced by an
 * informational toast. Undo is the app's substitute for confirmation dialogs,
 * so removing a track shows a snackbar instead of asking first; if a passing
 * "Added to Basement" could shove that off the screen, the undo would be gone
 * before the user's hand got there. An informational toast arriving during an
 * undo waits its turn instead.
 */

type ToastKind = "info" | "undo";

interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const INFO_MS = 2600;
const UNDO_MS = 6000;

interface ToastApi {
  /** A passing confirmation. Replaced freely by the next one. */
  toast: (message: string) => void;
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
      if (existing?.kind === "undo" && next.kind === "info") {
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
    const ms = current.kind === "undo" ? UNDO_MS : INFO_MS;
    const timer = window.setTimeout(() => setCurrent(null), ms);
    return () => window.clearTimeout(timer);
  }, [current]);

  const api = useMemo<ToastApi>(
    () => ({
      toast: (message) => show({ kind: "info", message }),
      undoToast: (message, onUndo, actionLabel = "Undo") =>
        show({ kind: "undo", message, actionLabel, onAction: onUndo }),
      setToastLift: setLift,
    }),
    [show]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {current ? (
        <div
          className="nav-rise"
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: 14,
            right: 14,
            // Clears the bottom nav, the Now Playing bar and the device inset,
            // plus whatever the contextual action bar has asked for.
            bottom: `calc(var(--nav-bottomnav-h) + var(--nav-nowplaying-h) + var(--tg-safe-bottom) + ${lift}px + 8px)`,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: 10,
            minHeight: 44,
            padding: "0 14px",
            borderRadius: 22,
            fontSize: 12.5,
          }}
        >
          <div
            className="nav-glass"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 22,
              pointerEvents: "none",
            }}
          />
          <span
            className="nav-clip"
            style={{ position: "relative", flex: 1, padding: "11px 0" }}
          >
            {current.message}
          </span>
          {current.onAction ? (
            <button
              className="nav-press"
              style={{
                position: "relative",
                color: "#DFFC8E",
                fontWeight: 600,
                fontSize: 12.5,
                minHeight: 44,
                paddingLeft: 6,
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
      ) : null}
    </Ctx.Provider>
  );
}
