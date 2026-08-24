import { useEffect, useRef } from "react";
import { HomeIcon, LibraryIcon, SocialIcon } from "../icons";
import type { IconProps } from "../icons";
import type { RootTab } from "../view";
import { haptic } from "../telegram";

/**
 * Home · Library · Social.
 *
 * A pill that hugs its three tabs and floats over the content, rather than a
 * bar ruled across the bottom of the screen. The active tab is a lime disc
 * with the name beside it; the other two are just their glyphs.
 *
 * Only the active tab carries a label. Three labelled pills at 13px would not
 * fit a 320px screen without shrinking the type below the floor, and the
 * inactive icons are only ever one tap from showing you what they are. The
 * label is what makes the lime disc read as a place rather than a button.
 *
 * The open/close of that label is CSS, in `.nav-tab*` — one duration and one
 * curve across the width, the colour and the disc, so the switch reads as one
 * movement.
 */

const TABS: { id: RootTab; label: string; icon: (p: IconProps) => React.ReactNode }[] =
  [
    { id: "home", label: "Home", icon: HomeIcon },
    { id: "library", label: "Library", icon: LibraryIcon },
    { id: "social", label: "Social", icon: SocialIcon },
  ];

export function BottomNav({
  active,
  onSelect,
}: {
  active: RootTab | null;
  onSelect: (tab: RootTab) => void;
}) {
  // Published so every scrollable view reserves exactly the room the pill
  // takes, which changes with the label and with the device inset.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty("--nav-bottomnav-h", `${el.offsetHeight}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <nav
      ref={ref}
      style={{
        flex: "none",
        display: "flex",
        justifyContent: "center",
        padding: "8px 14px 12px",
        paddingBottom: "calc(12px + var(--tg-safe-bottom))",
        position: "relative",
        zIndex: 30,
      }}
    >
      <div
        className="nav-bar-glass"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: 5,
          borderRadius: 28,
          pointerEvents: "auto",
        }}
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = active === id;
          return (
            <button
              key={id}
              aria-label={label}
              aria-current={on ? "page" : undefined}
              className="nav-press nav-tab"
              onClick={() => {
                haptic.select();
                onSelect(id);
              }}
            >
              <span className="nav-tab-disc">
                <Icon size={19} />
              </span>
              {/* Rendered at zero width when inactive rather than removed, so
                  the label grows out of the disc instead of popping in. */}
              <span className="nav-tab-label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
