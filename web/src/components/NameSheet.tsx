import { useEffect, useRef, useState } from "react";
import { ActionButton, Sheet } from "./ui";

/**
 * Asking for one short string: a new playlist, a rename.
 *
 * Not window.prompt. The native dialog is drawn by the Telegram client rather
 * than by the app, it ignores the theme entirely, and on some Android clients
 * it does not appear at all inside a Mini App WebView.
 */
export function NameSheet({
  open,
  title,
  initial = "",
  confirmLabel = "Save",
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      // A beat after the sheet starts rising, so the keyboard does not race
      // the animation and leave the field scrolled off screen.
      const timer = window.setTimeout(() => inputRef.current?.focus(), 240);
      return () => window.clearTimeout(timer);
    }
  }, [open, initial]);

  const submit = () => {
    const name = value.trim();
    if (!name) return;
    onSubmit(name);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div
        style={{ display: "flex", gap: 8, padding: "0 8px 12px" }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="nav-glass"
          style={{
            flex: 1,
            height: 40,
            borderRadius: 20,
            padding: "0 14px",
            fontSize: 13.5,
            color: "#fff",
            border: 0,
            outline: "none",
          }}
        />
        <ActionButton
          grow={false}
          height={40}
          disabled={value.trim().length === 0}
          onClick={submit}
        >
          {confirmLabel}
        </ActionButton>
      </div>
    </Sheet>
  );
}
