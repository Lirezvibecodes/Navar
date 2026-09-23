import type { AlbumTracklistMatch } from "../lib/albumTracklist";
import { CheckIcon } from "../icons";
import { Num, Sheet } from "./ui";

/**
 * Every track on the original release, for an album that isn't fully in the
 * Crate yet. Owned tracks carry the same check used on a complete album's
 * header; missing ones sit at the disabled-row opacity `SheetItem` already
 * uses elsewhere, so "dimmed" reads the same way it does everywhere else in
 * the app. Purely informational — there's nothing to tap a missing track
 * into doing.
 */
export function MissingTracksSheet({
  open,
  onClose,
  albumName,
  matched,
}: {
  open: boolean;
  onClose: () => void;
  albumName: string;
  matched: AlbumTracklistMatch["matched"];
}) {
  return (
    <Sheet open={open} onClose={onClose} title={albumName}>
      {matched.map((entry) => (
        <div
          key={entry.position}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            minHeight: 40,
            padding: "0 14px",
            opacity: entry.track ? 1 : 0.35,
          }}
        >
          <span
            style={{
              flex: "none",
              width: 18,
              textAlign: "right",
              fontSize: 12,
              color: "var(--color-nav-faint)",
            }}
          >
            <Num>{entry.position}</Num>
          </span>
          <span className="nav-clip" style={{ flex: 1, fontSize: 13.5 }}>
            {entry.title}
          </span>
          {entry.track ? (
            <CheckIcon
              size={14}
              style={{ flex: "none", color: "var(--color-nav-action)" }}
            />
          ) : null}
        </div>
      ))}
    </Sheet>
  );
}
