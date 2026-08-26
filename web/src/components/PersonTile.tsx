import { Avatar } from "./Avatar";
import type { Person } from "../types";
import { personName } from "../lib/format";
import { haptic } from "../telegram";

/**
 * A person in a horizontal shelf: face, name, and the one line under it.
 *
 * Home and Social both open with the same "Listening now" row, and for a while
 * both drew it themselves — the same 64px column, the same 52px ringed avatar,
 * the same two clipped labels. Two copies of a tile is two places to forget
 * when the ring or the type changes, so the tile lives here and the shelves
 * only decide who is in them.
 */
export function PersonTile({
  person,
  line,
  index,
  onOpen,
}: {
  person: Person;
  /** Whatever they are doing — usually a track title. Empty renders nothing. */
  line?: string;
  index: number;
  onOpen: () => void;
}) {
  return (
    <button
      className="nav-press nav-row-in"
      aria-label={line ? personName(person) + ", " + line : personName(person)}
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      style={
        {
          "--i": index,
          width: 64,
          flex: "none",
          textAlign: "center",
        } as React.CSSProperties
      }
    >
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Avatar
          userId={person.telegram_user_id}
          username={person.handle ?? person.username}
          hasAvatar={person.has_avatar}
          size={52}
          ring
        />
      </div>
      <span
        className="nav-clip"
        style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 600,
          marginTop: 6,
        }}
      >
        {personName(person)}
      </span>
      {line ? (
        <span
          className="nav-clip"
          style={{
            display: "block",
            fontSize: 11,
            color: "var(--color-nav-muted)",
          }}
        >
          {line}
        </span>
      ) : null}
    </button>
  );
}
