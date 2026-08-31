import { useRef, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Avatar } from "../components/Avatar";
import { ImageCropSheet } from "../components/ImageCropSheet";
import { NameSheet } from "../components/NameSheet";
import { AccentPicker } from "../context/ThemeContext";
import { Screen, SectionHeader, Toggle } from "../components/ui";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { haptic } from "../telegram";

/**
 * Everything about you that isn't for other people to look at: your name,
 * your picture, the app's accent, and who gets to see what you're playing.
 * Split out of the profile page, which stayed a read surface — the same one
 * a friend sees when they open you.
 */
export function SettingsView({ nav: _nav }: { nav: Navigation }) {
  const { me, setMe } = useLibrary();
  const { errorToast } = useToast();

  const [renaming, setRenaming] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // Bumped after a fresh upload so this session's own view of the avatar it
  // just replaced skips the browser's cache instead of showing the old bytes
  // until the picture happens to be refetched some other way.
  const [avatarBust, setAvatarBust] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const rename = async (typed: string) => {
    if (!me) return;
    try {
      const { handle } = await api.setHandle(typed);
      setMe({ ...me, handle });
      haptic.success();
    } catch (err) {
      errorToast(err, "Could not change your name");
    }
  };

  const uploadAvatar = async (image: Blob) => {
    setAvatarBusy(true);
    try {
      await api.uploadAvatar(image);
      setAvatarBust((n) => n + 1);
      haptic.success();
    } catch (err) {
      errorToast(err, "Could not set that picture");
    } finally {
      setAvatarBusy(false);
    }
  };

  const setAccent = async (name: string) => {
    if (!me) return;
    const prev = me.accent_color;
    setMe({ ...me, accent_color: name });
    try {
      await api.setAccentColor(name);
      haptic.success();
    } catch (err) {
      setMe({ ...me, accent_color: prev });
      errorToast(err, "Could not change that");
    }
  };

  /**
   * The listening switch.
   *
   * Applied to local state first, which is what actually turns reporting on:
   * the player watches this flag, so flipping it sends the track you are on
   * within the same tick rather than at the next song. Put back if the server
   * disagrees — this is the one setting where being wrong about it means
   * telling people something they asked not to tell.
   */
  const setListening = async (next: boolean) => {
    if (!me) return;
    setMe({ ...me, listening_public: next });
    try {
      await api.setListeningPrivacy(next);
      haptic.success();
    } catch (err) {
      setMe({ ...me, listening_public: !next });
      errorToast(err, "Could not change that");
    }
  };

  if (!me) return null;

  return (
    <Screen>
      <div
        className="nav-rise"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 9,
          padding: "10px 0 4px",
        }}
      >
        <button
          className="nav-press"
          aria-label="Change your photo"
          disabled={avatarBusy}
          onClick={() => {
            haptic.tap();
            fileRef.current?.click();
          }}
          style={{ borderRadius: "50%" }}
        >
          <Avatar
            userId={me.id}
            username={me.handle ?? me.username}
            hasAvatar={true}
            size={76}
            bust={avatarBust}
          />
        </button>
        {/* Tapping the name is the whole rename affordance — a control saying
            so would be louder than the thing it controls. */}
        <button
          className="nav-press"
          onClick={() => {
            haptic.tap();
            setRenaming(true);
          }}
          style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em" }}
        >
          {me.handle}
        </button>
      </div>

      <SectionHeader title="Privacy" />
      <Toggle
        label="Show friends what I am playing"
        hint="Only your friends, only while you are playing something, and only for a few minutes after you stop."
        checked={me.listening_public ?? false}
        onChange={(next) => void setListening(next)}
      />

      <SectionHeader title="Appearance" />
      <AccentPicker
        value={me.accent_color ?? "lime"}
        onSelect={(name) => void setAccent(name)}
      />

      <NameSheet
        open={renaming}
        title="Your name"
        initial={me.handle ?? ""}
        placeholder="yourname"
        maxLength={20}
        confirmLabel="Save"
        onSubmit={(value) => void rename(value)}
        onClose={() => setRenaming(false)}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) setCropFile(picked);
          if (fileRef.current) fileRef.current.value = "";
        }}
        style={{ display: "none" }}
      />
      <ImageCropSheet
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onConfirm={(blob) => {
          setCropFile(null);
          void uploadAvatar(blob);
        }}
      />
    </Screen>
  );
}
