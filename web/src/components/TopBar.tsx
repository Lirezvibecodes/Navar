import type { Me } from "../types";
import { Avatar } from "./Avatar";
import { RoundButton } from "./ui";
import { SearchIcon, SettingsIcon } from "../icons";
import { haptic } from "../telegram";

/**
 * Title, search, you.
 *
 * The bar floats over the screen rather than sitting above it — see
 * `.nav-topbar`. Content scrolls underneath and dissolves into the blur
 * instead of being cut off at a line, which is the only version of this that
 * reads as one screen rather than two boxes.
 *
 * There is no back affordance here. Telegram draws its own back button in the
 * client chrome and a second chevron inside the app would be two controls that
 * do the same thing in different places — the shell drives Telegram's instead.
 *
 * The top padding comes from Telegram's content inset rather than CSS env(),
 * which resolves to zero inside the Mini App WebView on iOS and would put the
 * title under the client's own header.
 */
export function TopBar({
  title,
  subdued = false,
  me,
  onSearch,
  onProfile,
  ownProfile = false,
  onSettings,
}: {
  title: string;
  /**
   * True on a screen that names itself in its own header — a playlist, an
   * album, an artist. The bar then says only what kind of thing you are
   * looking at, because printing the name twice, six lines apart, makes the
   * reader check whether they are the same name.
   */
  subdued?: boolean;
  me: Me | null;
  onSearch?: () => void;
  onProfile: () => void;
  /**
   * True while the screen already IS the viewer's own profile — the avatar
   * shortcut to "your profile" would just reopen the page underneath it, so
   * it is replaced with a shortcut to Settings instead.
   */
  ownProfile?: boolean;
  onSettings?: () => void;
}) {
  return (
    <header className="nav-topbar">
      {subdued ? (
        <span
          className="nav-clip"
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-nav-muted)",
          }}
        >
          {title}
        </span>
      ) : (
        <h1
          className="nav-display nav-clip"
          style={{ margin: 0, flex: 1, fontSize: 19, lineHeight: 1.1 }}
        >
          {title}
        </h1>
      )}

      {onSearch ? (
        <RoundButton icon={SearchIcon} label="Search" onClick={onSearch} />
      ) : null}

      {ownProfile ? (
        <RoundButton icon={SettingsIcon} label="Settings" onClick={() => onSettings?.()} />
      ) : (
        <button
          aria-label="Your profile"
          className="nav-press"
          onClick={() => {
            haptic.tap();
            onProfile();
          }}
          style={{ flex: "none", display: "flex", borderRadius: "50%" }}
        >
          <Avatar
            userId={me?.id ?? 0}
            username={me?.handle ?? me?.username ?? me?.first_name}
            size={34}
          />
        </button>
      )}
    </header>
  );
}
