import { useState } from "react";
import type { AlbumCopy } from "../api";
import * as api from "../api";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import type { AlbumTracklistMatch } from "../lib/albumTracklist";
import { CheckIcon, PlusIcon } from "../icons";
import { haptic } from "../telegram";
import { Avatar } from "./Avatar";
import { useKeepTrack } from "./TrackMenu";
import { Num, Sheet } from "./ui";

/**
 * Every track on the original release, for an album that isn't fully in the
 * Crate yet. Owned tracks carry the same check used on a complete album's
 * header; missing ones sit at the disabled-row opacity `SheetItem` already
 * uses elsewhere, so "dimmed" reads the same way it does everywhere else in
 * the app.
 *
 * The exception is a missing track somebody else has out in a public
 * playlist (`copies`, keyed by position): that row lights up with their face
 * and a + where the check would be, and tapping it keeps their copy exactly
 * the way saving from their playlist would. It lands in this album too — a
 * copy tagged with the same album in different case gets retagged to this
 * one, or the row would stay missing after the save.
 */
export function MissingTracksSheet({
  open,
  onClose,
  albumName,
  matched,
  copies,
}: {
  open: boolean;
  onClose: () => void;
  albumName: string;
  matched: AlbumTracklistMatch["matched"];
  copies: Map<number, AlbumCopy>;
}) {
  const { putTrack } = useLibrary();
  const { errorToast } = useToast();
  const keep = useKeepTrack();
  const [saving, setSaving] = useState<ReadonlySet<number>>(new Set());

  const saveCopy = async (position: number, copy: AlbumCopy) => {
    setSaving((prev) => new Set(prev).add(position));
    try {
      const saved = await keep.save(copy);
      if (saved && saved.album !== albumName) {
        putTrack(await api.updateTrack(saved.id, { album: albumName }));
      }
    } catch (err) {
      errorToast(err, "Could not add that to this album");
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(position);
        return next;
      });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={albumName}>
      {matched.map((entry) => {
        const copy = entry.track ? undefined : copies.get(entry.position);
        const busy = saving.has(entry.position);

        const content = (
          <>
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
            ) : copy ? (
              <span
                style={{
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: busy ? 0.4 : 1,
                  transition: "opacity var(--dur-state) var(--ease)",
                }}
              >
                <Avatar
                  userId={copy.uploader_id}
                  username={copy.uploader_name}
                  hasAvatar={copy.uploader_has_avatar}
                  size={18}
                />
                <PlusIcon size={14} style={{ color: "var(--color-nav-action)" }} />
              </span>
            ) : null}
          </>
        );

        const rowStyle: React.CSSProperties = {
          display: "flex",
          alignItems: "center",
          gap: 13,
          minHeight: 40,
          padding: "0 14px",
        };

        return copy ? (
          <button
            key={entry.position}
            className="nav-press"
            aria-label={`Add ${entry.title} to your Crate${
              copy.uploader_name ? `, from @${copy.uploader_name}` : ""
            }`}
            disabled={busy}
            onClick={() => {
              haptic.tap();
              void saveCopy(entry.position, copy);
            }}
            style={{ ...rowStyle, width: "100%", textAlign: "left" }}
          >
            {content}
          </button>
        ) : (
          <div
            key={entry.position}
            style={{ ...rowStyle, opacity: entry.track ? 1 : 0.35 }}
          >
            {content}
          </div>
        );
      })}
    </Sheet>
  );
}
