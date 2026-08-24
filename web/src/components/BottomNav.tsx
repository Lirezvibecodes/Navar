import { HomeIcon, LibraryIcon, SocialIcon } from "../icons";
import type { IconProps } from "../icons";
import type { RootTab } from "../view";
import { haptic } from "../telegram";

/**
 * Home · Library · Social.
 *
 * Only the active tab carries a label. Three labelled pills at 13px would not
 * fit a 320px screen without shrinking the type below the floor, and the
 * inactive icons are only ever one tap from showing you what they are. The
 * label is what makes the lime pill read as a place rather than a button.
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
  return (
    <nav
      style={{
        flex: "none",
        margin: "8px 14px 12px",
        marginBottom: "calc(12px + var(--tg-safe-bottom))",
        position: "relative",
        zIndex: 30,
      }}
    >
      <div
        className="nav-glass"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          height: 58,
          padding: "0 6px",
          borderRadius: 29,
        }}
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = active === id;
          return (
            <button
              key={id}
              aria-label={label}
              aria-current={on ? "page" : undefined}
              className="nav-press"
              onClick={() => {
                haptic.select();
                onSelect(id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                flex: 1,
                height: 46,
                borderRadius: 23,
                background: on ? "var(--color-nav-action)" : "transparent",
                color: on ? "#0A0A0A" : "rgba(255,255,255,.58)",
                boxShadow: on ? "0 4px 14px rgba(223,252,142,.22)" : undefined,
              }}
            >
              <Icon size={18} />
              {/* Rendered at zero width when inactive rather than removed, so
                  the label grows out of the pill instead of popping in. */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  maxWidth: on ? 80 : 0,
                  opacity: on ? 1 : 0,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  transition:
                    "max-width var(--dur-state) var(--ease), opacity var(--dur-tap) var(--ease)",
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
