import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { ActionButton } from "./ui";
import { haptic } from "../telegram";

/** The rules, kept in step with `server/src/handles.ts`. */
const SHAPE = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;

/**
 * Picking the name you go by in Navaar.
 *
 * A whole screen rather than a sheet, and it stands in front of the app rather
 * than over it, because it is not optional: the social half of Navaar is people
 * finding each other, and a person with no name cannot be found, introduced, or
 * credited. Asking once, at the door, costs a single tap for most people —
 * their Telegram username usually passes the rules unchanged and arrives in the
 * field already filled in.
 *
 * It validates as you type, but only to enable the button and never to scold:
 * the message under the field is the rule itself, not a complaint about what
 * you have typed so far. The one thing the client genuinely cannot know is
 * whether a name is already spoken for, so that answer comes back from the
 * server and is shown where the rule was.
 */
export function ChooseName({
  suggestion,
  onChosen,
}: {
  /** Their Telegram username, when it happens to be a legal handle. */
  suggestion: string;
  onChosen: (handle: string) => void;
}) {
  // An illegal suggestion is dropped rather than shown: a filled field the
  // person has to repair reads as the app having got their name wrong.
  const [value, setValue] = useState(SHAPE.test(suggestion) ? suggestion : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A beat, so the keyboard follows the screen in rather than racing it.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 260);
    return () => window.clearTimeout(timer);
  }, []);

  const handle = value.trim().replace(/^@+/, "");
  const wellFormed = SHAPE.test(handle);

  const submit = async () => {
    if (!wellFormed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.setHandle(handle);
      haptic.success();
      onChosen(saved.handle);
    } catch (err) {
      haptic.warning();
      setError(err instanceof Error ? err.message : "Could not save that name");
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="nav-rise"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 10,
        padding: "0 26px",
        position: "relative",
        zIndex: 1,
      }}
    >
      <h1
        className="nav-display"
        style={{ margin: 0, fontSize: 21, lineHeight: 1.15 }}
      >
        Pick your name
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "rgba(255,255,255,.6)",
        }}
      >
        This is how friends find you in Navaar, and how you are credited when
        someone saves a track from you. You can change it later.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <span
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: "rgba(255,255,255,.35)",
          }}
        >
          @
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="yourname"
          maxLength={21}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="nav-glass"
          style={{
            flex: 1,
            minWidth: 0,
            height: 44,
            borderRadius: 22,
            padding: "0 16px",
            fontSize: 15,
            color: "#fff",
            border: 0,
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      </div>

      <span
        style={{
          fontSize: 11.5,
          lineHeight: 1.45,
          minHeight: 32,
          color: error ? "#ff8f8f" : "rgba(255,255,255,.42)",
        }}
      >
        {error ??
          "3–20 characters, starting with a letter. Letters, numbers and underscores."}
      </span>

      <ActionButton height={46} disabled={!wellFormed || saving} onClick={() => void submit()}>
        {saving ? "Saving…" : "That's me"}
      </ActionButton>
    </div>
  );
}
