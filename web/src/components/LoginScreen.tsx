import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "../types";
import { pollBotLogin, startBotLogin } from "../api";
import { ActionButton, GhostButton } from "./ui";

/**
 * Signing in to the installed web app, through the bot.
 *
 * The code is fetched before the button is pressed, not after: opening
 * Telegram has to happen inside the tap, and a browser treats a window opened
 * after an awaited request as a popup it may block. So the screen always
 * holds a fresh code, and the tap only opens its link and starts listening.
 */

const POLL_MS = 2000;

type Phase = "ready" | "waiting" | "error";

export function LoginScreen({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<{ code: string; link: string; expiresAt: number } | null>(null);
  const done = useRef(false);

  const fetchCode = useCallback(async () => {
    try {
      setLogin(await startBotLogin());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach Navaar");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void fetchCode();
  }, [fetchCode]);

  // A code lasts five minutes; replace it a little before then so a tap never
  // opens a dead link.
  useEffect(() => {
    if (!login) return;
    const timer = window.setTimeout(() => void fetchCode(), Math.max(0, login.expiresAt - Date.now() - 30_000));
    return () => window.clearTimeout(timer);
  }, [login, fetchCode]);

  // While waiting: ask every couple of seconds, and at once when the person
  // comes back from Telegram, which is the moment they have most likely
  // confirmed.
  useEffect(() => {
    if (phase !== "waiting" || !login) return;
    let stopped = false;
    const check = async () => {
      if (stopped || done.current) return;
      try {
        const me = await pollBotLogin(login.code);
        if (me && !done.current) {
          done.current = true;
          onSignedIn(me);
        }
      } catch (err) {
        if (stopped) return;
        // Expired or already used: start over with a fresh code.
        setError(err instanceof Error ? err.message : "That sign-in expired");
        setPhase("ready");
        void fetchCode();
      }
    };
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, login, onSignedIn, fetchCode]);

  const openTelegram = () => {
    if (!login) return;
    window.open(login.link, "_blank", "noopener");
    setError(null);
    setPhase("waiting");
  };

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        padding: "calc(24px + var(--tg-safe-top)) 28px calc(24px + var(--tg-safe-bottom))",
        textAlign: "center",
      }}
    >
      <Mark />
      <div>
        <div className="nav-display" style={{ fontSize: 34, color: "#dffc8e", letterSpacing: "0.02em" }}>
          Navaar
        </div>
        <div style={{ marginTop: 8, fontSize: 14, color: "var(--color-nav-muted)" }}>
          Your music, kept in Telegram.
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 320, marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        {phase === "waiting" ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Waiting for you in Telegram…</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--color-nav-muted)" }}>
              In the Navaar bot, tap <b>Start</b>, then <b>Yes, log me in</b>. Then come back here.
            </div>
            <GhostButton height={44} onClick={openTelegram}>
              Open Telegram again
            </GhostButton>
            <GhostButton height={36} onClick={() => setPhase("ready")}>
              Cancel
            </GhostButton>
          </>
        ) : (
          <>
            <ActionButton height={50} onClick={openTelegram} disabled={!login}>
              Log in with Telegram
            </ActionButton>
            <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--color-nav-muted)" }}>
              Opens the Navaar bot. Your library, playlists and friends are the same as in Telegram.
            </div>
            {phase === "error" ? (
              <GhostButton height={36} onClick={() => void fetchCode()}>
                Try again
              </GhostButton>
            ) : null}
          </>
        )}
        {error ? <div style={{ fontSize: 12, color: "var(--color-nav-danger)" }}>{error}</div> : null}
      </div>
    </div>
  );
}

/** The app mark, from the same three columns as favicon.svg. */
export function Mark({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <rect width="16" height="16" rx="3" fill="#030303" stroke="rgba(255,255,255,0.12)" strokeWidth="0.25" />
      <g fill="#DFFC8E">
        <rect x="5" y="3" width="2" height="10" />
        <rect x="7" y="5" width="2" height="6" />
        <rect x="9" y="7" width="2" height="2" />
      </g>
    </svg>
  );
}
