import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import { scrollBehavior } from "../lib/motion";
import {
  activeLineAt,
  gapBefore,
  parseLyrics,
  type Lyrics as Parsed,
} from "../lib/lyrics";
import { haptic } from "../telegram";

/**
 * The words: a three-line strip under the transport, and the full pane behind
 * the Lyrics chip.
 *
 * Both used to live inside PlayerView, which had grown past fifteen hundred
 * lines and was three screens in one file. Nothing about the lookup changed on
 * the way out.
 *
 * The pane is modelled on the one everybody already knows from Apple Music,
 * with one honest omission: that screen fills a line word by word, and LRCLIB
 * returns line-level timings only. No source in this stack knows when a
 * syllable lands, so the karaoke fill is not attempted. Everything else about
 * that screen - the size of the type, the three states, the anchored scroll,
 * the way it waits when you touch it - is line-level, and is here.
 */

export interface Words {
  state: "loading" | "ready" | "none";
  lyrics: Parsed | null;
}

/**
 * One lookup per track, shared by the strip under the transport and the pane
 * behind it. The server caches both answers, including "LRCLIB has never heard
 * of this", so a track is only ever looked up once however often it is played.
 */
export function useLyrics(trackId: string | null): Words {
  const [words, setWords] = useState<Words>({ state: "loading", lyrics: null });

  useEffect(() => {
    if (!trackId) return;
    let live = true;
    setWords({ state: "loading", lyrics: null });
    api
      .getLyrics(trackId)
      .then((raw) => {
        if (!live) return;
        const lyrics = parseLyrics(raw);
        setWords({ state: lyrics ? "ready" : "none", lyrics });
      })
      .catch(() => {
        if (live) setWords({ state: "none", lyrics: null });
      });
    return () => {
      live = false;
    };
  }, [trackId]);

  return words;
}

/** Which line is being sung, or the first one when nobody timed the file. */
function activeIn(lyrics: Parsed | null, position: number): number {
  if (!lyrics) return -1;
  if (lyrics.kind !== "timed") return 0;
  return activeLineAt(lyrics.lines, position);
}

/**
 * The words under the transport, three lines at a time.
 *
 * A window that does not move over a column that does: the line being sung is
 * held in the middle band and the verse slides past it. That is the whole
 * illusion, and it is why the column is translated by whole line-heights
 * rather than each line animating to its own new place - lines that move
 * individually arrive at slightly different times and read as a list
 * reshuffling rather than as a song going by.
 *
 * It renders nothing when there is nothing to render. A strip sitting there
 * empty would be a promise the track cannot keep.
 */
export function LyricStrip({
  words,
  position,
  onOpen,
}: {
  words: Words;
  position: number;
  onOpen: () => void;
}) {
  const { state, lyrics } = words;
  const active = useMemo(() => activeIn(lyrics, position), [lyrics, position]);

  if (state !== "ready" || !lyrics || lyrics.lines.length === 0) return null;

  return (
    <button
      className="nav-press"
      aria-label="Open lyrics"
      onClick={onOpen}
      style={{
        display: "block",
        width: "100%",
        padding: "2px 18px 6px",
        textAlign: "center",
      }}
    >
      <span className="nav-lyric-strip" style={{ display: "block" }}>
        <span
          className="nav-lyric-track"
          style={{
            display: "block",
            transform: `translateY(calc(${1 - Math.max(0, active)} * var(--lyric-line)))`,
          }}
        >
          {lyrics.lines.map((line, i) => (
            <span
              key={i}
              className="nav-lyric-line"
              data-on={i === active}
              style={{ display: "block" }}
            >
              {line.text || " "}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

/**
 * Where the sung line settles: a little above the middle, so you are always
 * reading into the song rather than out of it.
 */
const ANCHOR = 0.38;

/** How long the pane waits after you stop touching it before it takes over. */
const RESUME_AFTER = 4000;

/** A silence longer than this is an interlude rather than a pause. */
const INTERLUDE = 5;

export function LyricsPane({
  words,
  position,
  onSeek,
}: {
  words: Words;
  position: number;
  onSeek: (seconds: number) => void;
}) {
  const { state, lyrics } = words;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  // True while the reader has the pane: they touched it, and it is theirs
  // until they hand it back or leave it alone for four seconds. The old pane
  // had no such state, which is exactly why it and the finger fought.
  const [held, setHeld] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);

  const timed = lyrics?.kind === "timed";
  const active = useMemo(
    () => (lyrics && lyrics.kind === "timed" ? activeLineAt(lyrics.lines, position) : -1),
    [lyrics, position]
  );

  const release = useCallback(() => {
    window.clearTimeout(holdTimer.current);
    setHeld(false);
  }, []);

  const hold = useCallback(() => {
    setHeld(true);
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setHeld(false), RESUME_AFTER);
  }, []);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  // The follow. One scroll of the pane's own scroller, rather than
  // `scrollIntoView` on the line: that centred every line, which put all of
  // what is coming below the fold, and it moves the nearest scrollable
  // ancestor - which inside the player is not reliably this one.
  useEffect(() => {
    if (!timed || held) return;
    const box = boxRef.current;
    const line = lineRefs.current[Math.max(0, active)];
    if (!box || !line) return;
    box.scrollTo({
      top: Math.max(0, line.offsetTop - box.clientHeight * ANCHOR),
      behavior: scrollBehavior(),
    });
  }, [active, held, timed]);

  if (state === "loading" || state === "none" || !lyrics) {
    return (
      <div className="nav-scroll" style={{ flex: 1, minHeight: 0, padding: "10px 22px" }}>
        <p style={{ fontSize: 12.5, color: "var(--color-nav-muted)", lineHeight: 1.6 }}>
          {state === "loading" ? "Looking for lyrics…" : "No lyrics found for this one."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <div
        ref={boxRef}
        className="nav-scroll nav-lyric-pane"
        // The player dismisses itself on a downward drag. This is one of the
        // few places where a vertical drag means something else.
        data-own-drag
        onPointerDown={timed ? hold : undefined}
        style={{ height: "100%", padding: "14px 22px 0" }}
      >
        {lyrics.lines.map((line, i) => (
          <div key={i}>
            {timed && gapBefore(lyrics.lines, i) > INTERLUDE ? (
              <span
                className="nav-lyric-gap"
                aria-hidden="true"
                data-on={active === i - 1}
              >
                <i />
                <i />
                <i />
              </span>
            ) : null}
            <p
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className="nav-lyric-big"
              data-state={
                !timed ? "plain" : i === active ? "on" : i < active ? "past" : "coming"
              }
              data-far={timed && active >= 0 && Math.abs(i - active) >= 3}
              onClick={() => {
                if (!timed || line.at == null) return;
                haptic.select();
                onSeek(line.at);
                // Seeking is asking to be taken back to the song, so the hold
                // that this same tap started is spent immediately.
                release();
              }}
            >
              {line.text || " "}
            </p>
          </div>
        ))}

        {/* Room under the last line, so it too can reach the anchor instead of
            stopping wherever the scroller happens to run out. */}
        <div style={{ height: "60vh" }} aria-hidden="true" />
      </div>

      {timed && held ? (
        <button
          className="nav-press nav-glass"
          onClick={() => {
            haptic.tap();
            release();
          }}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 14,
            transform: "translateX(-50%)",
            height: 34,
            padding: "0 16px",
            borderRadius: 17,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-nav-action)",
            whiteSpace: "nowrap",
          }}
        >
          Back to the song
        </button>
      ) : null}
    </div>
  );
}
