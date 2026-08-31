import { useEffect } from "react";
import type { Me } from "../types";

/**
 * The accent picker's 8 presets, replacing lime's "action" role wherever it
 * appears. The other two fixed colours — periwinkle for people, pale blue for
 * secondary artwork — and the one danger red are not customisable; only the
 * role lime plays is. Every preset is a pastel, same family as the app's own
 * default, so the dark ink already used on top of lime stays readable on all
 * eight without a second contrast decision per colour.
 */
export const ACCENT_PRESETS: Record<string, { action: string; soft: string }> = {
  lime: { action: "#c6f24a", soft: "#e6f7c4" },
  peach: { action: "#ffab5c", soft: "#ffdcb8" },
  blush: { action: "#ff85a1", soft: "#ffd0da" },
  lilac: { action: "#b083ff", soft: "#e0cfff" },
  mint: { action: "#5be8ad", soft: "#c3f5de" },
  sand: { action: "#e8c96a", soft: "#f5e7bd" },
  gold: { action: "#ffc93c", soft: "#ffe6a0" },
  aqua: { action: "#4fd6ff", soft: "#bdefff" },
};

const DEFAULT_NAME = "lime";

let liveHex = ACCENT_PRESETS[DEFAULT_NAME].action;

/**
 * The one caller that cannot read a CSS variable: Telegram's MainButton is
 * drawn natively, outside the DOM, so it needs the actual hex rather than
 * `var(--color-nav-action)`.
 */
export function currentAccentHex(): string {
  return liveHex;
}

/** "#rrggbb" -> "r, g, b", for use inside rgba(var(--x), alpha). */
function hexToRgbChannels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function apply(name: string): void {
  const preset = ACCENT_PRESETS[name] ?? ACCENT_PRESETS[DEFAULT_NAME];
  liveHex = preset.action;
  const root = document.documentElement.style;
  root.setProperty("--color-nav-action", preset.action);
  root.setProperty("--color-nav-action-soft", preset.soft);
  root.setProperty("--color-nav-action-rgb", hexToRgbChannels(preset.action));
}

/**
 * Applies `me.accent_color` to the document root for as long as this is
 * mounted. Every other consumer already reads `--color-nav-action`/
 * `-action-soft`, so nothing else needs to know this exists.
 */
export function ThemeEffect({ me }: { me: Me }) {
  useEffect(() => {
    apply(me.accent_color);
  }, [me.accent_color]);
  return null;
}

/** The 8 swatches, for wherever the picker is offered. */
export function AccentPicker({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (name: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {Object.entries(ACCENT_PRESETS).map(([name, preset]) => {
        const active = value === name;
        return (
          <button
            key={name}
            className="nav-press"
            aria-label={name}
            aria-current={active}
            onClick={() => onSelect(name)}
            style={{
              width: 34,
              height: 34,
              flex: "none",
              padding: 0,
              borderRadius: "50%",
              background: preset.action,
              boxShadow: active
                ? "0 0 0 2px var(--color-nav-bg), 0 0 0 4px rgba(255,255,255,.7)"
                : "0 0 0 2px var(--color-nav-bg), 0 0 0 3px rgba(255,255,255,.12)",
            }}
          />
        );
      })}
    </div>
  );
}
