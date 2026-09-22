import { useEffect, useRef } from "react";
import { HomeIcon, LibraryIcon, SocialIcon } from "../icons";
import type { IconProps } from "../icons";
import type { RootTab } from "../view";
import { haptic } from "../telegram";

/**
 * Home · Library · Social.
 *
 * Three separate buttons floating over the content — not one bar, and not one
 * pill with three tabs inside it. Each tab that is not the current place is its
 * own dark circle; the current one grows sideways into a glass capsule holding
 * a lime disc and its name. Content runs through the gaps between them, which
 * is what makes the row read as floating rather than as a rule across the
 * bottom of the screen.
 *
 * The geometry is measured off the reference rather than chosen: a 52px
 * circle, a 44px lime disc sitting 4px inside a 52px-tall capsule, 5px between
 * tabs, 8px from the disc to the label and 15px from the label to the capsule's
 * end. Those add up to the reference's capsule almost exactly.
 *
 * The label is white. Only the glyph inside the lime disc is dark — the disc is
 * the one surface bright enough to carry dark type, and putting that colour on
 * the whole button is what made the name unreadable.
 *
 * Only the current tab is named. Three labelled capsules will not fit a 320px
 * screen without dropping the type below its floor, and the label is what makes
 * the lime disc read as a place rather than as a button.
 *
 * The open and close of that label is CSS, in `.nav-tab*`: one duration and one
 * curve across the width, the colours, the glass and the disc together, so the
 * switch is a single movement instead of several racing each other.
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
  // Published so every scrollable view reserves exactly the room the row takes,
  // which changes with the device inset.
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
        alignItems: "center",
        gap: 5,
        padding: "8px 12px 12px",
        paddingBottom: "calc(12px + var(--tg-safe-bottom))",
        position: "relative",
        zIndex: "var(--z-bottom-bar)",
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
            style={{ pointerEvents: "auto" }}
            onClick={() => {
              haptic.select();
              onSelect(id);
            }}
          >
            <span className="nav-tab-disc">
              {/* One size in both states. These glyphs are drawn on a whole-unit
                  pixel grid, and growing the active one would resample it
                  mid-transition and lose the hard edges the set is built on. */}
              <Icon size={20} />
            </span>
            {/* Rendered at zero width when inactive rather than removed, so the
                name grows out of the disc instead of popping in beside it. The
                inner span exists to carry the spacing as margins: margins are
                inside the clipped box and collapse with it, where padding on
                the label itself would survive the collapse and leave every
                inactive glyph off-centre. See .nav-tab-label. */}
            <span className="nav-tab-label">
              <span>{label}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
