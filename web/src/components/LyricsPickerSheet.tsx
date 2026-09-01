import { useEffect, useMemo, useState, type CSSProperties } from "react";
import * as api from "../api";
import { parseLyrics, type LyricLine } from "../lib/lyrics";
import type { Track } from "../types";
import { Sheet, SheetItem } from "./ui";
import { CheckIcon, CloseIcon } from "../icons";

/** A picked passage this long already fills the card and the video's whole
 *  10 seconds several times over — past this, extending further wouldn't
 *  make the output better, just harder to lay out. */
const MAX_PICK = 10;

/**
 * Which lines of a track's lyrics, if any, ride along on its story card —
 * always a consecutive passage, the way Apple Music's own lyric-sharing
 * picker works: tap a line to start it, tap another to draw the passage
 * between them. A third tap outside that two-line anchor starts over rather
 * than trying to grow a passage from three points at once.
 *
 * Rendered with the same `.nav-lyric-big` states the full lyrics pane uses
 * (`Lyrics.tsx`), so picking a passage looks like the pane itself rather
 * than a separate checkbox list bolted on next to it.
 */
export function LyricsPickerSheet({
  track,
  onPick,
  onClose,
}: {
  track: Track | null;
  onPick: (lines: { text: string; at: number | null }[]) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState<string | null | undefined>(undefined);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    setAnchor(null);
    setFocus(null);
    if (!track) {
      setRaw(undefined);
      return;
    }
    let live = true;
    setRaw(undefined);
    void api.getLyrics(track.id).then((text) => {
      if (live) setRaw(text);
    });
    return () => {
      live = false;
    };
  }, [track]);

  const lines: LyricLine[] = useMemo(() => {
    const parsed = parseLyrics(raw);
    return (parsed?.lines ?? []).filter((line) => line.text);
  }, [raw]);

  const range =
    anchor == null || focus == null
      ? null
      : ([Math.min(anchor, focus), Math.max(anchor, focus)] as const);

  const tapLine = (i: number) => {
    if (anchor == null || anchor !== focus) {
      // Nothing picked yet, or a passage of two-or-more lines already exists —
      // either way this tap starts a fresh single-line anchor.
      setAnchor(i);
      setFocus(i);
    } else if (i !== anchor) {
      // Exactly one line anchored: draw the passage out to this line,
      // clamped so the passage never grows past MAX_PICK lines.
      const clamped =
        Math.abs(i - anchor) + 1 > MAX_PICK
          ? i > anchor
            ? anchor + MAX_PICK - 1
            : anchor - MAX_PICK + 1
          : i;
      setFocus(clamped);
    }
  };

  const skip = () => {
    onPick([]);
    onClose();
  };

  const confirm = () => {
    if (!range) return;
    onPick(lines.slice(range[0], range[1] + 1).map((l) => ({ text: l.text, at: l.at })));
    onClose();
  };

  const count = range ? range[1] - range[0] + 1 : 0;

  return (
    <Sheet open={track != null} onClose={onClose} title="Pick a passage for the card">
      <SheetItem icon={CloseIcon} label="Skip — no lyrics" onClick={skip} />
      {raw === undefined ? (
        <p style={noteStyle}>Looking for lyrics…</p>
      ) : lines.length === 0 ? (
        <p style={noteStyle}>No lyrics found for this track.</p>
      ) : (
        <>
          <div
            className="nav-scroll nav-lyric-pane"
            style={{ maxHeight: "42vh", overflowY: "auto", padding: "10px 18px 4px" }}
          >
            {lines.map((line, i) => {
              const picked = range != null && i >= range[0] && i <= range[1];
              return (
                <p
                  key={i}
                  className="nav-press nav-lyric-big"
                  data-state={range == null ? "plain" : picked ? "on" : "past"}
                  onClick={() => tapLine(i)}
                  style={{ cursor: "pointer" }}
                >
                  {line.text}
                </p>
              );
            })}
          </div>
          <div style={{ padding: "10px 14px 0" }}>
            <button
              className="nav-press"
              disabled={count === 0}
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
                opacity: count === 0 ? 0.35 : 1,
              }}
            >
              <CheckIcon size={14} />
              {count === 0 ? "Tap a line to start" : `Use ${count} line${count > 1 ? "s" : ""}`}
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
