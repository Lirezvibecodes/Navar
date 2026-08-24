import { useEffect, useRef, useState } from "react";
import { ActionButton, Sheet } from "./ui";

/**
 * Asking for one piece of text: a new playlist, a rename, a description.
 *
 * Not window.prompt. The native dialog is drawn by the Telegram client rather
 * than by the app, it ignores the theme entirely, and on some Android clients
 * it does not appear at all inside a Mini App WebView.
 *
 * The multiline variant is the same sheet with a textarea and a counter, rather
 * than a second component, because everything around the field — the rise, the
 * focus delay that lets the keyboard follow the animation instead of racing it,
 * the trim-and-close — is the part worth having once.
 */
export function NameSheet({
  open,
  title,
  initial = "",
  confirmLabel = "Save",
  placeholder,
  multiline = false,
  maxLength,
  /** A description can be deleted by saving an empty one; a name cannot. */
  allowEmpty = false,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial?: string;
  confirmLabel?: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  allowEmpty?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      // A beat after the sheet starts rising, so the keyboard does not race
      // the animation and leave the field scrolled off screen.
      const timer = window.setTimeout(() => inputRef.current?.focus(), 240);
      return () => window.clearTimeout(timer);
    }
  }, [open, initial]);

  const trimmed = value.trim();
  const submittable = allowEmpty || trimmed.length > 0;

  const submit = () => {
    if (!submittable) return;
    onSubmit(trimmed);
    onClose();
  };

  const field: React.CSSProperties = {
    width: "100%",
    borderRadius: multiline ? 18 : 20,
    padding: multiline ? "11px 14px" : "0 14px",
    fontSize: 13.5,
    lineHeight: 1.45,
    color: "#fff",
    border: 0,
    outline: "none",
    resize: "none",
    fontFamily: "inherit",
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {multiline ? (
        <div style={{ padding: "0 8px 12px" }}>
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            rows={4}
            className="nav-glass"
            style={field}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
            }}
          >
            {maxLength ? (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>
                {value.length} / {maxLength}
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            <ActionButton
              grow={false}
              height={40}
              disabled={!submittable}
              onClick={submit}
            >
              {confirmLabel}
            </ActionButton>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, padding: "0 8px 12px" }}>
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={placeholder}
            maxLength={maxLength}
            className="nav-glass"
            style={{ ...field, flex: 1, height: 40 }}
          />
          <ActionButton
            grow={false}
            height={40}
            disabled={!submittable}
            onClick={submit}
          >
            {confirmLabel}
          </ActionButton>
        </div>
      )}
    </Sheet>
  );
}
