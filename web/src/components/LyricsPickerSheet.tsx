import { useEffect, useState, type CSSProperties } from "react";
import * as api from "../api";
import type { Track } from "../types";
import { Sheet, SheetDivider, SheetItem } from "./ui";
import { CheckIcon, CloseIcon } from "../icons";

const MAX_LINES = 4;

/**
 * Which lines of a track's lyrics, if any, ride along on its story card — up
 * to four, kept in their original order regardless of tap order. Skip sits
 * above the list rather than at the bottom of it, because a track with no
 * lyrics on file is the common case and shouldn't cost a scroll to get past.
 */
export function LyricsPickerSheet({
  track,
  onPick,
  onClose,
}: {
  track: Track | null;
  onPick: (lines: string[]) => void;
  onClose: () => void;
}) {
  const [lyrics, setLyrics] = useState<string | null | undefined>(undefined);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    setPicked(new Set());
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

  const toggle = (i: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else if (next.size < MAX_LINES) next.add(i);
      return next;
    });
  };

  const skip = () => {
    onPick([]);
    onClose();
  };

  const confirm = () => {
    onPick(
      [...picked]
        .sort((a, b) => a - b)
        .map((i) => lines[i])
    );
    onClose();
  };

  return (
    <Sheet open={track != null} onClose={onClose} title="Pick up to 4 lines for the card">
      <SheetItem icon={CloseIcon} label="Skip — no lyrics" onClick={skip} />
      <SheetDivider />
      {lyrics === undefined ? (
        <p style={noteStyle}>Looking for lyrics…</p>
      ) : lines.length === 0 ? (
        <p style={noteStyle}>No lyrics found for this track.</p>
      ) : (
        <>
          <div
            className="nav-scroll"
            style={{ maxHeight: "40vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}
          >
            {lines.map((line, i) => {
              const selected = picked.has(i);
              return (
                <button
                  key={i}
                  className="nav-press"
                  onClick={() => toggle(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    textAlign: "left",
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    fontSize: 13,
                    lineHeight: 1.4,
                    color: "var(--color-nav-text)",
                    background: selected ? "rgba(var(--color-nav-action-rgb),.12)" : undefined,
                  }}
                >
                  <span
                    style={{
                      flex: "none",
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#0A0A0A",
                      background: selected ? "var(--color-nav-action)" : "transparent",
                      border: selected ? "none" : "1.5px solid var(--color-nav-faint)",
                      transition:
                        "background-color var(--dur-tap) var(--ease), border-color var(--dur-tap) var(--ease)",
                    }}
                  >
                    <CheckIcon size={12} style={{ opacity: selected ? 1 : 0 }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>{line}</span>
                </button>
              );
            })}
          </div>
          <div style={{ padding: "10px 14px 0" }}>
            <button
              className="nav-press"
              disabled={picked.size === 0}
              onClick={confirm}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                color: "#0A0A0A",
                background: "var(--color-nav-action)",
                opacity: picked.size === 0 ? 0.35 : 1,
              }}
            >
              <CheckIcon size={14} />
              {picked.size === 0 ? "Pick a line" : `Use ${picked.size} line${picked.size > 1 ? "s" : ""}`}
            </button>
          </div>
        </>
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
