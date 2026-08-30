import { useEffect, useState, type CSSProperties } from "react";
import * as api from "../api";
import type { Track } from "../types";
import { Sheet, SheetDivider, SheetItem } from "./ui";
import { CloseIcon } from "../icons";

/**
 * Which line of a track's lyrics, if any, rides along on its story card.
 * Skip sits above the list rather than at the bottom of it, because a track
 * with no lyrics on file is the common case and shouldn't cost a scroll to
 * get past.
 */
export function LyricsPickerSheet({
  track,
  onPick,
  onClose,
}: {
  track: Track | null;
  onPick: (line: string | null) => void;
  onClose: () => void;
}) {
  const [lyrics, setLyrics] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!track) {
      setLyrics(undefined);
      return;
    }
    let live = true;
    setLyrics(undefined);
    void api.getLyrics(track.id).then((text) => {
      if (live) setLyrics(text);
    });
    return () => {
      live = false;
    };
  }, [track]);

  const lines = (lyrics ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const pick = (line: string | null) => {
    onPick(line);
    onClose();
  };

  return (
    <Sheet open={track != null} onClose={onClose} title="Pick a line for the card">
      <SheetItem icon={CloseIcon} label="Skip — no lyric line" onClick={() => pick(null)} />
      <SheetDivider />
      {lyrics === undefined ? (
        <p style={noteStyle}>Looking for lyrics…</p>
      ) : lines.length === 0 ? (
        <p style={noteStyle}>No lyrics found for this track.</p>
      ) : (
        <div
          className="nav-scroll"
          style={{ maxHeight: "44vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}
        >
          {lines.map((line, i) => (
            <button
              key={i}
              className="nav-press"
              onClick={() => pick(line)}
              style={{
                textAlign: "left",
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.4,
                color: "var(--color-nav-text)",
              }}
            >
              {line}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

const noteStyle: CSSProperties = {
  margin: 0,
  padding: "6px 14px 14px",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--color-nav-muted)",
};
