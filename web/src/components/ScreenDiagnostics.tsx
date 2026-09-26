import { useEffect, useState } from "react";
import { getTelegramWebApp } from "../telegram";

/**
 * Temporary: the numbers the shell sizes itself from, read live, for tracking
 * down the bottom nav sitting in the wrong place on some larger phones. The
 * shell's height comes from what Telegram reports (see applyViewport in
 * telegram.ts), so the only way to see why it is wrong on a given phone is to
 * look at those figures on that phone. Collapsed until tapped, and meant to be
 * removed once the nav is fixed.
 */
export function ScreenDiagnostics() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const read = () => setLines(measure());
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, [open]);

  return (
    <div style={{ marginTop: 28, marginBottom: 12 }}>
      <button
        className="nav-press"
        onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 11.5, color: "var(--color-nav-faint)" }}
      >
        {open ? "Hide screen diagnostics" : "Screen diagnostics"}
      </button>
      {open ? (
        <pre
          style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 10,
            background: "rgba(255,255,255,0.05)",
            fontSize: 10.5,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            userSelect: "text",
            WebkitUserSelect: "text",
          }}
        >
          {lines.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

function measure(): string[] {
  const tg = getTelegramWebApp() as
    | (ReturnType<typeof getTelegramWebApp> & {
        isExpanded?: boolean;
        isFullscreen?: boolean;
      })
    | undefined;
  const root = document.getElementById("root");
  const nav = document.querySelector("nav");
  const vv = window.visualViewport;
  const css = getComputedStyle(document.documentElement);
  const inset = (v?: { top: number; bottom: number }) => (v ? `top ${v.top} · bottom ${v.bottom}` : "none");
  const r = (n: number | undefined) => (n === undefined ? "?" : Math.round(n * 10) / 10);

  return [
    `platform ${tg?.platform ?? "none"} · tg ${tg?.version ?? "?"} · expanded ${tg?.isExpanded ?? "?"} · fullscreen ${tg?.isFullscreen ?? "?"}`,
    `screen ${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
    `window.innerHeight ${window.innerHeight} · clientHeight ${document.documentElement.clientHeight}`,
    `visualViewport ${r(vv?.height)} · offsetTop ${r(vv?.offsetTop)} · scrollY ${r(window.scrollY)}`,
    `tg.viewportHeight ${r(tg?.viewportHeight)} · stable ${r(tg?.viewportStableHeight)}`,
    `tg.safeArea ${inset(tg?.safeAreaInset)}`,
    `tg.contentSafeArea ${inset(tg?.contentSafeAreaInset)}`,
    `env(safe-area-inset-bottom) ${envBottom()}`,
    `--tg-viewport-height ${css.getPropertyValue("--tg-viewport-height").trim() || "unset"}`,
    `--nav-bottomnav-h ${css.getPropertyValue("--nav-bottomnav-h").trim() || "unset"}`,
    `#root height ${r(root?.getBoundingClientRect().height)}`,
    `nav bottom ${r(nav?.getBoundingClientRect().bottom)} · gap below nav ${r(
      nav ? window.innerHeight - nav.getBoundingClientRect().bottom : undefined
    )}`,
  ];
}

/** env() can only be read by letting the browser lay it out. */
function envBottom(): string {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).paddingBottom;
  probe.remove();
  return value;
}
