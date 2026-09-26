import { useEffect, useLayoutEffect, useState } from "react";
import { ActionButton, GhostButton } from "../components/ui";
import { Mark } from "../components/LoginScreen";
import { hideSplash } from "../lib/splash";

/**
 * The page to send people: navaar.onrender.com/get.
 *
 * It says what the installed app is and walks through adding it to the home
 * screen, which differs by platform. Android and desktop Chrome can install
 * from a button (beforeinstallprompt); iOS only allows it from Safari's own
 * Share sheet, so there it is a numbered walk-through instead. Already
 * running installed, it just offers to open the app.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; the touch screen gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallPage() {
  const [platform] = useState(detectPlatform);
  const [installed, setInstalled] = useState(isInstalled);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [telegram, setTelegram] = useState<string | null>(null);

  // index.html's boot splash is only taken down by the app shell, which this
  // page never mounts.
  useLayoutEffect(() => hideSplash(), []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    fetch("/api/auth/bot-info")
      .then((r) => r.json())
      .then((info: { chat?: string | null }) => setTelegram(info.chat ?? null))
      .catch(() => undefined);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        height: "100%",
        overflowY: "auto",
        padding: "calc(40px + env(safe-area-inset-top, 0px)) 24px calc(32px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 26 }}>
        <header style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center" }}>
          <Mark size={84} />
          <div>
            <h1 className="nav-display" style={{ margin: 0, fontSize: 40, color: "#dffc8e", letterSpacing: "0.02em" }}>
              Navaar
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: 15, color: "var(--color-nav-muted)" }}>
              Your music, kept in Telegram. Now on your home screen too.
            </p>
          </div>
        </header>

        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
          <Feature title="Same library everywhere" body="Log in with Telegram. Everything you forward to the bot shows up here." />
          <Feature title="Download for offline" body="Save songs, playlists and albums to your phone and play them with no connection." />
          <Feature title="Opens instantly" body="A real app on your home screen, no need to open Telegram first." />
        </ul>

        <section className="nav-glass" style={{ borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {installed ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Navaar is installed.</div>
              <ActionButton height={48} onClick={() => window.location.assign("/")}>
                Open Navaar
              </ActionButton>
            </>
          ) : platform === "ios" ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Add it to your Home Screen</div>
              <Step n={1}>
                Tap the{" "}
                <b style={{ whiteSpace: "nowrap" }}>
                  Share <ShareGlyph />
                </b>{" "}
                button in Safari's toolbar.
              </Step>
              <Step n={2}>
                Scroll down and tap <b>Add to Home Screen</b>.
              </Step>
              <Step n={3}>
                Open <b>Navaar</b> from your Home Screen and log in with Telegram.
              </Step>
              <Hint>
                Don't see Add to Home Screen? You're probably in another app's browser. Open this page in
                Safari first.
              </Hint>
            </>
          ) : prompt ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Install the app</div>
              <ActionButton
                height={48}
                onClick={() => {
                  void prompt.prompt();
                  void prompt.userChoice.then((c) => {
                    if (c.outcome === "accepted") setInstalled(true);
                    setPrompt(null);
                  });
                }}
              >
                Install Navaar
              </ActionButton>
            </>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Install the app</div>
              <Step n={1}>
                Open your browser's menu <b>⋮</b>.
              </Step>
              <Step n={2}>
                Tap <b>{platform === "android" ? "Add to Home screen" : "Install Navaar"}</b>
                {platform === "android" ? " or Install app" : ""}.
              </Step>
              <Step n={3}>Open Navaar and log in with Telegram.</Step>
              <Hint>Works best in Chrome. Inside another app's browser, open this page in Chrome first.</Hint>
            </>
          )}
        </section>

        {telegram ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: "var(--color-nav-muted)" }}>Rather stay in Telegram?</span>
            <GhostButton height={40} width={220} onClick={() => window.open(telegram, "_blank", "noopener")}>
              Open the Navaar bot
            </GhostButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, marginTop: 6, background: "#dffc8e", flex: "none" }} />
      <span>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", marginTop: 2, fontSize: 13, lineHeight: 1.45, color: "var(--color-nav-muted)" }}>
          {body}
        </span>
      </span>
    </li>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 14, lineHeight: 1.4 }}>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          flex: "none",
          display: "grid",
          placeItems: "center",
          background: "#dffc8e",
          color: "#0b0c0e",
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {n}
      </span>
      <span>{children}</span>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--color-nav-muted)" }}>{children}</div>;
}

/** A plain square-and-arrow, the shape iOS uses for Share. */
function ShareGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ verticalAlign: "-3px", color: "#89aeff" }}
      aria-label="Share"
    >
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11H5v10h14V11h-1" />
    </svg>
  );
}
