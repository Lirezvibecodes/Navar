import { useEffect, useState } from "react";
import * as api from "../api";
import { useToast } from "../context/ToastContext";
import { CheckIcon, LinkIcon, SocialIcon, UserIcon } from "../icons";
import { haptic, shareLink } from "../telegram";
import type { IconProps } from "../icons";
import type { Playlist, PlaylistVisibility } from "../types";
import { ActionButton, GhostButton, Sheet, SheetDivider } from "./ui";

/**
 * Who can see a playlist, and the link that follows from the answer.
 *
 * The three levels are named for what they actually do rather than for the
 * values in the column. In particular the third is "Anyone with the link" and
 * never "Public": there is no directory, nothing is listed anywhere, and the
 * slug in the URL is the entire credential — anybody it reaches can play the
 * playlist forever, with no Telegram account. Calling that "Public" would
 * describe the listing that doesn't exist instead of the sharing that does.
 *
 * Friends is offered as the recommendation because it is the level that keeps
 * a name attached to the reader: a friend opening the playlist is somebody the
 * owner agreed to, and the check happens inside Telegram every time.
 */

interface Level {
  value: PlaylistVisibility;
  label: string;
  body: string;
  icon: (props: IconProps) => React.ReactNode;
}

const LEVELS: Level[] = [
  {
    value: "private",
    label: "Only me",
    body: "Nobody else can open it. Any link you have handed out stops working.",
    icon: UserIcon,
  },
  {
    value: "friends",
    label: "Friends",
    body: "The people you are friends with see it in your library. Recommended.",
    icon: SocialIcon,
  },
  {
    value: "public",
    label: "Anyone with the link",
    body: "Anyone you send the link to can play it, without Telegram and without an account.",
    icon: LinkIcon,
  },
];

export function ShareSheet({
  open,
  onClose,
  playlist,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  playlist: Playlist | undefined;
  onChange: (playlist: Playlist) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // Replacing the link cannot be undone and breaks whatever is already out
  // there, so the button asks once before it does it.
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  useEffect(() => {
    if (!open) setConfirmingRotate(false);
  }, [open]);

  if (!playlist) return null;
  const url = api.shareUrl(playlist);

  const choose = async (visibility: PlaylistVisibility) => {
    if (visibility === playlist.visibility) return;
    setBusy(true);
    setConfirmingRotate(false);
    try {
      onChange(await api.updatePlaylist(playlist.id, { visibility }));
      haptic.success();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change that");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!confirmingRotate) {
      setConfirmingRotate(true);
      haptic.warning();
      return;
    }
    setBusy(true);
    setConfirmingRotate(false);
    try {
      onChange(await api.rotatePlaylistSlug(playlist.id));
      haptic.success();
      toast("The old link no longer works");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not make a new link");
    } finally {
      setBusy(false);
    }
  };

  // Telegram's own forward sheet is the right way to hand somebody a link from
  // inside a chat app. Outside it there is nothing to open, so the URL is shown
  // instead and can be copied by hand.
  const send = () => {
    if (!url) return;
    if (!shareLink(url, `${playlist.name} on Navaar`)) toast(url);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Who can see this">
      <div style={{ padding: "0 6px" }}>
        {LEVELS.map((level) => (
          <LevelRow
            key={level.value}
            level={level}
            chosen={playlist.visibility === level.value}
            disabled={busy}
            onChoose={() => void choose(level.value)}
          />
        ))}
      </div>

      {url ? (
        <>
          <SheetDivider />
          <div style={{ padding: "2px 14px 12px" }}>
            <p
              className="nav-glass nav-clip"
              style={{
                margin: 0,
                padding: "10px 12px",
                borderRadius: 12,
                fontSize: 11.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: "rgba(255,255,255,.78)",
              }}
            >
              {url}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <ActionButton height={38} onClick={send}>
                Send to a chat
              </ActionButton>
              <GhostButton height={38} disabled={busy} onClick={() => void rotate()}>
                {confirmingRotate ? "Break the old one?" : "New link"}
              </GhostButton>
            </div>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

function LevelRow({
  level,
  chosen,
  disabled,
  onChoose,
}: {
  level: Level;
  chosen: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const Icon = level.icon;
  return (
    <button
      className="nav-press"
      role="radio"
      aria-checked={chosen}
      disabled={disabled}
      onClick={() => {
        haptic.tap();
        onChoose();
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        width: "100%",
        padding: "9px 8px",
        borderRadius: 12,
        textAlign: "left",
        background: chosen ? "rgba(223,252,142,.07)" : undefined,
      }}
    >
      <span
        style={{
          flex: "none",
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 20,
          color: chosen ? "var(--color-nav-action)" : "rgba(255,255,255,.42)",
        }}
      >
        <Icon size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: chosen ? "var(--color-nav-action)" : "#fff",
          }}
        >
          {level.label}
        </span>
        <span
          style={{
            display: "block",
            marginTop: 2,
            fontSize: 11,
            lineHeight: 1.45,
            color: "rgba(255,255,255,.52)",
          }}
        >
          {level.body}
        </span>
      </span>
      {chosen ? (
        <span
          style={{
            flex: "none",
            display: "grid",
            placeItems: "center",
            width: 20,
            height: 20,
            borderRadius: 10,
            background: "var(--color-nav-action)",
            color: "#0A0A0A",
          }}
        >
          <CheckIcon size={11} />
        </span>
      ) : null}
    </button>
  );
}
