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
  lime: { action: "#dffc8e", soft: "#eaf7c9" },
  peach: { action: "#ffcfa8", soft: "#ffe6cf" },
  blush: { action: "#ffc2d1", soft: "#ffdde6" },
  lilac: { action: "#d8c2ff", soft: "#ebdcff" },
  mint: { action: "#b6f2d8", soft: "#d8f8e9" },
  sand: { action: "#f2e2b6", soft: "#f8f0d8" },
  gold: { action: "#f7dd8a", soft: "#fbecc0" },
  aqua: { action: "#a8ecff", soft: "#d3f5ff" },
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

function apply(name: string): void {
  const preset = ACCENT_PRESETS[name] ?? ACCENT_PRESETS[DEFAULT_NAME];
  liveHex = preset.action;
  const root = document.documentElement.style;
  root.setProperty("--color-nav-action", preset.action);
  root.setProperty("--color-nav-action-soft", preset.soft);
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
