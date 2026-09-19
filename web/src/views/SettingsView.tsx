import { useRef, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Avatar } from "../components/Avatar";
import { ImageCropSheet } from "../components/ImageCropSheet";
import { NameSheet } from "../components/NameSheet";
import { CoverPicker } from "./PlaylistView";
import { AccentPicker } from "../context/ThemeContext";
import { GhostButton, Screen, SectionHeader, Sheet, SheetDivider, Toggle } from "../components/ui";
import { EditIcon, ImageIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { cacheKey, ttl, useCached } from "../lib/cache";
import { haptic } from "../telegram";
import { bannerLayerStyle, usePixelatedBanner } from "./ProfileView";

/**
 * Everything about you that isn't for other people to look at: your name,
 * your picture, the app's accent, and who gets to see what you're playing.
 * Split out of the profile page, which stayed a read surface — the same one
 * a friend sees when they open you.
 */
export function SettingsView({ nav: _nav }: { nav: Navigation }) {
  const { me, tracks, setMe } = useLibrary();
  const { errorToast } = useToast();

  const [renaming, setRenaming] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // Bumped after a fresh upload so this session's own view of the avatar it
  // just replaced skips the browser's cache instead of showing the old bytes
  // until the picture happens to be refetched some other way.
  const [avatarBust, setAvatarBust] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickingBg, setPickingBg] = useState(false);

  // Same cache key `ProfileView` reads for this same person, so changing the
  // background here shows up there the moment you navigate back — no extra
  // wiring, just the one shared cache entry both screens already agree on.
  const {
    data: profile,
    set: setProfile,
  } = useCached(
    cacheKey.profile(me?.id ?? 0),
    () => (me ? api.getProfile(me.id) : Promise.reject(new Error("Not signed in"))),
    ttl.profile
  );

  // Same computed-default-with-override `ProfileView` shows on this same
  // person's header, so the banner behind your picture here is the exact
  // banner everyone else already sees on your page.
  const bgTrackId = profile?.background_track_id ?? profile?.stats?.topTrack?.cover_track_id ?? null;
  const bannerUrl = usePixelatedBanner(bgTrackId ? api.trackCoverUrl(bgTrackId) : null);

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

  /**
   * Pin a track's cover as the profile header's background, or null to go
   * back to a wash of the most-played track — the same override-on-a-
   * computed-default shape a playlist's own cover already is. Mirrors
   * `PlaylistView`'s `chooseCover`: close the sheet, update optimistically,
   * revert on failure.
   */
  const chooseBackground = async (trackId: string | null) => {
    if (!profile) return;
    const before = profile;
    setPickingBg(false);
    setProfile({ ...profile, background_track_id: trackId });
    try {
      await api.setProfileBackground(trackId);
    } catch (err) {
      setProfile(before);
      errorToast(err, "Could not change your background");
    }
  };

  if (!me) return null;

  return (
    <Screen scrollKey="settings">
      {/* The same header banner your profile shows everyone else, with the
          picture and its own controls sitting on top of it rather than a
          plain stack above a separate "change header" row below. */}
      <div
        className="nav-rise nav-profile-banner"
        style={{
          margin: "calc(-1 * (var(--nav-topbar-h) + var(--nav-top-inset) + 8px)) -14px 0",
          padding: "calc(var(--nav-topbar-h) + var(--nav-top-inset) + 22px) 16px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 9,
        }}
      >
        {bannerUrl ? <div aria-hidden style={bannerLayerStyle(bannerUrl)} /> : null}

        <button
          className="nav-press"
          aria-label="Change your photo"
          disabled={avatarBusy}
          onClick={() => {
            haptic.tap();
            fileRef.current?.click();
          }}
          style={{ position: "relative", zIndex: 1, borderRadius: "50%" }}
        >
          <Avatar
            userId={me.id}
            username={me.handle ?? me.username}
            hasAvatar={true}
            size={76}
            bust={avatarBust}
          />
          {/* The avatar itself was the only "change your picture" affordance
              — nothing on it said so. This badge is that hint. */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              right: -2,
              bottom: -2,
              width: 24,
              height: 24,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--color-nav-action)",
              color: "#0A0A0A",
              border: "2.5px solid #030303",
            }}
          >
            <EditIcon size={11} />
          </span>
        </button>

        {/* Tapping the name is the whole rename affordance — a control saying
            so would be louder than the thing it controls. */}
        <button
          className="nav-press"
          onClick={() => {
            haptic.tap();
            setRenaming(true);
          }}
          style={{ position: "relative", zIndex: 1, fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em" }}
        >
          {me.handle}
        </button>

        <button
          className="nav-glass nav-press"
          onClick={() => {
            haptic.tap();
            setPickingBg(true);
          }}
          style={{
            position: "absolute",
            zIndex: 1,
            right: 14,
            bottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px 0 10px",
            borderRadius: 15,
            fontSize: 11.5,
            fontWeight: 600,
            color: "#fff",
          }}
        >
          <ImageIcon size={13} />
          Change header
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

      <Sheet open={pickingBg} onClose={() => setPickingBg(false)} title="Profile background">
        <div style={{ padding: "2px 12px 10px" }}>
          <GhostButton
            height={34}
            disabled={!profile?.background_track_id}
            onClick={() => void chooseBackground(null)}
          >
            Use most-played track
          </GhostButton>
        </div>
        <SheetDivider />
        <CoverPicker
          tracks={tracks}
          chosen={profile?.background_track_id ?? null}
          onPick={(trackId) => void chooseBackground(trackId)}
          emptyBody="None of your tracks carry cover art yet. Forward one that does, and it can stand for your header."
        />
      </Sheet>
    </Screen>
  );
}
