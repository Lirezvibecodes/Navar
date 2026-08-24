import type { Me } from "../types";
import { Avatar } from "./Avatar";
import { RoundButton } from "./ui";
import { SearchIcon } from "../icons";
import { haptic } from "../telegram";

/**
 * Title, search, you.
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
  me,
  onSearch,
  onProfile,
}: {
  title: string;
  me: Me | null;
  onSearch?: () => void;
  onProfile: () => void;
}) {
  return (
    <header
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 52,
        padding: "0 14px",
        paddingTop: "var(--tg-content-top)",
        boxSizing: "content-box",
      }}
    >
      <h1
        className="nav-display nav-clip"
        style={{ margin: 0, flex: 1, fontSize: 19, lineHeight: 1.1 }}
      >
        {title}
      </h1>

      {onSearch ? (
        <RoundButton icon={SearchIcon} label="Search" onClick={onSearch} />
      ) : null}

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
          username={me?.username ?? me?.first_name}
          size={34}
        />
      </button>
    </header>
  );
}
