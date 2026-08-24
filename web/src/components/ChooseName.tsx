import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { ActionButton } from "./ui";
import { CheckIcon, SparklesIcon, TagIcon } from "../icons";
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
 * the line under the field is the rule itself, not a complaint about what you
 * have typed so far, and it turns into the name you are about to get as soon as
 * what you have typed would be accepted. The one thing the client genuinely
 * cannot know is whether a name is already spoken for, so that answer comes
 * back from the server and is shown in the same place.
 *
 * Layout: this screen draws no top bar, so it has to reserve Telegram's own
 * inset itself or the heading lands underneath the client's header. And it is a
 * scroll container that centres its card with `margin: auto` rather than with
 * `justify-content`, because the keyboard takes most of the viewport as soon as
 * the field is focused: auto margins collapse to zero once the free space runs
 * out, where centring would keep pushing the top of the card off-screen, where
 * it cannot be scrolled back to.
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
      style={{
        height: "100%",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        zIndex: 1,
        padding:
          "calc(var(--nav-top-inset) + 24px) 26px calc(var(--tg-safe-bottom) + 24px)",
      }}
    >
      <div
        className="nav-rise"
        style={{
          margin: "auto 0",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <NameTag lit={wellFormed} />

        <h1
          className="nav-display"
          style={{ margin: "2px 0 0", fontSize: 21, lineHeight: 1.15 }}
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

        <div
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}
        >
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: wellFormed
                ? "var(--color-nav-action)"
                : "rgba(255,255,255,.35)",
              transition: "color 160ms ease",
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

        {/* One line, one job, and it is the same line throughout: the rule
            while the name is still forming, the name itself once it would be
            accepted, and whatever the server said if it refused. Its height is
            reserved so that none of the three moves the button. */}
        <span
          style={{
            fontSize: 11.5,
            lineHeight: 1.45,
            minHeight: 32,
            color: error
              ? "#ff8f8f"
              : wellFormed
                ? "var(--color-nav-action)"
                : "rgba(255,255,255,.42)",
          }}
        >
          {error ??
            (wellFormed
              ? `Friends will find you as @${handle}.`
              : "3–20 characters, starting with a letter. Letters, numbers and underscores.")}
        </span>

        {/* The button is as wide as its own words. It was full-bleed, which on
            a screen with one field made it read as the screen's floor rather
            than as something you press. */}
        <div style={{ display: "flex" }}>
          <ActionButton
            height={42}
            grow={false}
            icon={CheckIcon}
            disabled={!wellFormed || saving}
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : "That's me"}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

/**
 * The one picture on the screen: a luggage tag waiting to be written on, which
 * lights up the moment the name in the field would be accepted. That is the
 * whole of the feedback it gives — there is no unhappy state, because a name
 * that is only half typed is not a mistake.
 */
function NameTag({ lit }: { lit: boolean }) {
  return (
    <div style={{ position: "relative", width: 62, height: 62 }}>
      <div
        className="nav-glass"
        style={{
          width: 62,
          height: 62,
          borderRadius: 20,
          display: "grid",
          placeItems: "center",
          color: lit ? "var(--color-nav-action)" : "rgba(255,255,255,.5)",
          boxShadow: lit
            ? "0 10px 30px rgba(0,0,0,.55), 0 0 0 1px rgba(223,252,142,.35), 0 8px 26px rgba(223,252,142,.18)"
            : undefined,
          transition: "color 200ms ease, box-shadow 200ms ease",
        }}
      >
        <TagIcon size={28} />
      </div>
      {lit ? (
        <span
          className="nav-pop"
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            display: "grid",
            placeItems: "center",
            color: "var(--color-nav-action)",
          }}
        >
          <SparklesIcon size={18} />
        </span>
      ) : null}
    </div>
  );
}
