import { useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { AddFriendButton } from "./SocialView";
import { CoverPicker } from "./PlaylistView";
import { Avatar } from "../components/Avatar";
import { CollectionArt } from "../components/PixelArt";
import { PersonTile } from "../components/PersonTile";
import {
  Counted,
  Empty,
  EYEBROW,
  GhostButton,
  Screen,
  SectionHeader,
  Sheet,
  SheetDivider,
  Skeleton,
} from "../components/ui";
import {
  ChevronRightIcon,
  HeadphonesIcon,
  ImageIcon,
  LibraryIcon,
  SettingsIcon,
  StarIcon,
} from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { cacheKey, dropCache, ttl, useCached } from "../lib/cache";
import { formatListened, personName } from "../lib/format";
import { drawPixelatedWash } from "../lib/pixelWash";
import { loadImage } from "../lib/storyCard";
import { haptic } from "../telegram";
import type { BadgeTier, Playlist } from "../types";

/** The banner's own pixelated wash, drawn at its own modest size rather than
 *  a story card's full 1080×1920 — same technique as the story-share
 *  background (`lib/pixelWash.ts`), a different canvas. */
const BANNER_W = 480;
const BANNER_H = 220;

/**
 * A wash of whichever cover the header is showing, recomputed whenever that
 * cover changes. There is exactly one owner and one viewer of it at a time,
 * so nothing here needs to persist past the component that asked for it.
 */
function usePixelatedBanner(coverUrl: string | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!coverUrl) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const img = await loadImage(coverUrl);
      if (cancelled || !img) return;
      const canvas = document.createElement("canvas");
      canvas.width = BANNER_W;
      canvas.height = BANNER_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Finer, softer blocks than the story card's own wash (pixelW 54/blur
      // 8): that card is a shared-to-story image where the mosaic itself is
      // the point, but a banner sits behind readable text on every visit, so
      // it stays a soft wash rather than a chunky mosaic — more, smaller
      // source blocks plus a heavier blur.
      drawPixelatedWash(ctx, img, BANNER_W, BANNER_H, 110, 16);
      if (!cancelled) setDataUrl(canvas.toDataURL("image/jpeg", 0.85));
    })();
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return dataUrl;
}

/**
 * One person's page — yours or somebody else's.
 *
 * There is one screen rather than two because the difference between them is
 * only which affordances are live: your own page offers a background picker
 * and counts drawn from the library already in memory, and someone else's
 * offers the relationship. Everything else — where you stand, what they have earned,
 * and whatever of theirs you are allowed to open — arrives in a single call
 * that is already scoped to you, so nothing on this page decides who may see
 * what.
 */
export function ProfileView({ nav, userId }: { nav: Navigation; userId: number }) {
  const { me, tracks, playlists } = useLibrary();
  const { errorToast } = useToast();

  const isMe = me?.id === userId;
  // Cached per person, so stepping back out of somebody's page and into it
  // again — which is most of how the Social tab is used — costs nothing.
  const {
    data: profile,
    loading,
    set: setProfile,
  } = useCached(
    cacheKey.profile(userId),
    () => api.getProfile(userId),
    ttl.profile
  );

  const [pickingBg, setPickingBg] = useState(false);

  const unfriend = async () => {
    try {
      await api.removeFriend(userId);
      // Their page, your friend list and the feed all said you were connected.
      dropCache(cacheKey.profile(userId), cacheKey.friends, cacheKey.activity);
      haptic.warning();
      nav.pop();
    } catch (err) {
      errorToast(err, "Could not remove them");
    }
  };

  /**
   * Say their taste is worth following.
   *
   * Only offered when the server said it had been earned, so the failure path
   * here is a genuine failure rather than the ordinary refusal.
   */
  const endorse = async () => {
    if (!profile) return;
    setProfile({ ...profile, endorsed: true, can_endorse: false });
    try {
      await api.endorse(userId);
      haptic.success();
    } catch (err) {
      setProfile({ ...profile, endorsed: false, can_endorse: true });
      errorToast(err, "Could not endorse them");
    }
  };

  /**
   * Pin a track's cover as the header's background, or null to go back to a
   * wash of the most-played track — the same override-on-a-computed-default
   * shape a playlist's own cover already is. Mirrors `PlaylistView`'s
   * `chooseCover`: close the sheet, update optimistically, revert on failure.
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

  // The header's photo defaults to the owner's most-played track and can be
  // overridden with any cover from their own library — an override on a
  // computed default, the same shape `playlists.cover_track_id` already is.
  const bgTrackId = profile?.background_track_id ?? profile?.stats?.topTrack?.cover_track_id ?? null;
  const bannerUrl = usePixelatedBanner(bgTrackId ? api.trackCoverUrl(bgTrackId) : null);

  if (loading) {
    return (
      <Screen>
        <Skeleton rows={3} />
      </Screen>
    );
  }

  const person = profile?.person ?? null;
  const name = personName(isMe ? me : person);
  const known = profile?.state === "friends";
  const stats = profile?.stats;
  // The backend already scopes this to what the viewer may see — public
  // playlists from a stranger, public-and-friends ones from a friend — so
  // showing it regardless of `known` is just trusting that scoping instead
  // of throwing away half of it here.
  const shared = !isMe ? (profile?.playlists ?? []) : [];
  const ownPlaylists = isMe ? playlists.slice(0, 3) : [];

  // The meta line under the name: just friends now. Lifetime listening moved
  // into its own lime ListenChip beside the tier — a number this good is a
  // stat worth wearing, not a clause buried in a grey sentence. Your own
  // track and playlist counts used to live here too; they're one scroll away
  // in the Playlists section below, so saying them twice just crowded a line
  // the header now also spends on favourites.
  const metaParts: React.ReactNode[] = [];
  if (profile?.friend_count != null) {
    metaParts.push(
      <Counted key="friends" count={profile.friend_count} one="friend" many="friends" />
    );
  }

  return (
    <Screen>
      {/* One cohesive banner rather than a centred stack: avatar beside the
          name, the stats folded into the same line instead of a separate
          gradient card further down — the shape the reference asked for,
          bled to the screen's true top/edges so it sits behind the floating,
          blurring TopBar the way that bar already documents content doing. */}
      <div
        className="nav-rise nav-profile-banner"
        style={{
          margin:
            "calc(-1 * (var(--nav-topbar-h) + var(--nav-top-inset) + 8px)) -14px 0",
          padding:
            "calc(var(--nav-topbar-h) + var(--nav-top-inset) + 28px) 16px 18px",
        }}
      >
        {/* A pixelated wash of the header's chosen track, under everything
            else — same technique as the story-share background, at the
            banner's own size. Absolutely positioned so it paints under the
            content below (CSS 2.1's painting order would otherwise put a
            plain in-flow layer *over* positioned content at the same stack
            level); the class's own noise-and-gradient wash still shows
            through whenever nobody has a most-played track yet, so there is
            nothing to gate this on beyond `bannerUrl` itself. The scrim is
            flatter and stronger than the story card's own bottom-third
            gradient, because a name and two favourites sit across this
            banner's full height and all of it has to stay legible. */}
        {bannerUrl ? (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(180deg, rgba(3,3,3,.6), rgba(3,3,3,.7) 50%, rgba(3,3,3,.9)), url(${bannerUrl}) center/cover no-repeat`,
            }}
          />
        ) : null}

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar
              userId={userId}
              username={isMe ? (me?.handle ?? me?.username) : (person?.handle ?? person?.username)}
              hasAvatar={isMe ? true : (person?.has_avatar ?? false)}
              size={84}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                className="nav-clip nav-display"
                style={{
                  display: "block",
                  fontSize: 25,
                  lineHeight: 1.15,
                  letterSpacing: "-0.01em",
                }}
              >
                {name}
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginTop: 6,
                  flexWrap: "wrap",
                }}
              >
                {profile ? <TierChip tier={profile.tier} own={isMe} /> : null}
                {stats && stats.totalListenedSeconds > 0 ? (
                  <ListenChip seconds={stats.totalListenedSeconds} />
                ) : null}
                {metaParts.length > 0 ? (
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,.68)" }}>
                    {metaParts.reduce<React.ReactNode[]>(
                      (acc, part, i) => (i === 0 ? [part] : [...acc, " · ", part]),
                      []
                    )}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Favourite track and favourite artist, folded into the header
              itself now rather than living in a stats grid below the fold —
              the one thing worth a hero spot doesn't need a whole section to
              say it. */}
          {stats?.topTrack || stats?.topArtist ? (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {stats.topTrack ? (
                <FavoriteChip
                  label="Favourite track"
                  value={stats.topTrack.title ?? "Untitled"}
                  coverTrackId={stats.topTrack.cover_track_id}
                />
              ) : null}
              {stats.topArtist ? (
                <FavoriteChip
                  label="Favourite artist"
                  value={stats.topArtist.name}
                  coverTrackId={stats.topArtist.cover_track_id}
                  round
                />
              ) : null}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {isMe ? (
              <>
                <GhostButton
                  label="Change background"
                  icon={ImageIcon}
                  width={38}
                  height={38}
                  onClick={() => setPickingBg(true)}
                />
                <GhostButton
                  label="Settings"
                  icon={SettingsIcon}
                  width={38}
                  height={38}
                  onClick={() => nav.push({ type: "settings" })}
                />
              </>
            ) : (
              <>
                {known ? (
                  <>
                    <GhostButton
                      icon={LibraryIcon}
                      onClick={() => nav.push({ type: "friendLibrary", friendId: userId })}
                    >
                      Their Library
                    </GhostButton>
                    <GhostButton onClick={() => void unfriend()}>Remove</GhostButton>
                  </>
                ) : profile?.state === "pending_out" ? (
                  <GhostButton disabled onClick={() => undefined}>
                    Requested
                  </GhostButton>
                ) : (
                  <AddFriendButton userId={userId} />
                )}
                {profile?.can_endorse ? (
                  <GhostButton icon={StarIcon} onClick={() => void endorse()}>
                    Endorse
                  </GhostButton>
                ) : profile?.endorsed ? (
                  <GhostButton icon={StarIcon} disabled onClick={() => undefined}>
                    Endorsed
                  </GhostButton>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {isMe ? (
        <>
          <SectionHeader
            title="Playlists"
            action="Manage"
            onAction={() => nav.push({ type: "library" })}
          />
          {ownPlaylists.length > 0 ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ownPlaylists.map((playlist, i) => (
                  <PlaylistRow
                    key={playlist.id}
                    playlist={playlist}
                    subtitle={<Counted count={playlist.track_count ?? 0} one="track" />}
                    index={i}
                    onOpen={() =>
                      nav.push({ type: "playlist", id: playlist.id, name: playlist.name })
                    }
                  />
                ))}
              </div>
              {playlists.length > ownPlaylists.length ? (
                <GhostButton
                  height={38}
                  onClick={() => nav.push({ type: "library" })}
                  label="See all playlists"
                >
                  See all playlists
                </GhostButton>
              ) : null}
            </>
          ) : (
            <Empty title="No playlists yet" body="Anything you make from The Crate shows up here." />
          )}
        </>
      ) : (
        <>
          {!known && (profile?.mutual_friends.length ?? 0) > 0 ? (
            <>
              <SectionHeader title="Friends in common" />
              <div className="nav-shelf" style={{ gap: 12 }}>
                {profile!.mutual_friends.map((friend, i) => (
                  <PersonTile
                    key={friend.telegram_user_id}
                    person={friend}
                    index={i}
                    onOpen={() =>
                      nav.push({ type: "profile", userId: Number(friend.telegram_user_id) })
                    }
                  />
                ))}
              </div>
            </>
          ) : null}

          {/* Whatever of theirs the viewer is allowed to open — public
              playlists from anyone, plus friends-only ones once you are
              actually friends. "Their Library" above is the fuller screen for
              a friend; this is the same set of playlists, right here. */}
          {shared.length > 0 ? (
            <>
              <SectionHeader title={known ? "Playlists" : "Shared with everyone"} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {shared.map((playlist, i) => (
                  <PlaylistRow
                    key={playlist.id}
                    playlist={playlist}
                    subtitle={personName(person)}
                    index={i}
                    onOpen={() =>
                      nav.push({ type: "playlist", id: playlist.id, name: playlist.name })
                    }
                  />
                ))}
              </div>
            </>
          ) : !known ? (
            <Empty
              title="Not connected yet"
              body="Send a request. Once they accept, anything they share with friends shows up for you."
            />
          ) : null}
        </>
      )}

      {isMe ? (
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
      ) : null}
    </Screen>
  );
}

/**
 * What somebody has earned, as a word.
 *
 * Every tier renders identically — same icon, same weight, same size — because
 * the alternative is a chip that gets louder as the number behind it grows,
 * which is the number again wearing a costume. The number itself never leaves
 * the server.
 *
 * The tier everybody starts on is shown on your own page and nowhere else: a
 * column of identical chips down a list of people would say nothing about any
 * of them, and would bury the ones that mean something.
 */
function TierChip({ tier, own }: { tier: BadgeTier; own: boolean }) {
  if (tier.min === 0 && !own) return null;
  return (
    <span
      className="nav-glass"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 24,
        padding: "0 11px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        color: "#fff",
      }}
    >
      <StarIcon size={11} />
      {tier.label}
    </span>
  );
}

/**
 * Lifetime listening, worn as its own lime pill next to the tier chip rather
 * than folded into the grey meta sentence below the name — the same "earned
 * number deserves its own weight" treatment the tier chip already gets, on
 * the app's one accent colour instead of glass so it actually reads as a
 * highlight and not another line of muted text.
 */
function ListenChip({ seconds }: { seconds: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 24,
        padding: "0 11px 0 9px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 700,
        color: "#0A0A0A",
        background: "var(--color-nav-action)",
        boxShadow: "0 4px 14px rgba(var(--color-nav-action-rgb),.35)",
      }}
    >
      <HeadphonesIcon size={12} />
      {formatListened(seconds)} listened
    </span>
  );
}

/**
 * A favourite, worn as a small glass pill inside the banner itself — cover
 * art (or a star, when even the artist's own tracks carry none) beside a
 * small-caps label and the value. This is what the stats grid's most-played
 * tiles used to say below the fold; folding them into the header is what the
 * reference asked for directly.
 */
function FavoriteChip({
  label,
  value,
  coverTrackId,
  round,
}: {
  label: string;
  value: string;
  coverTrackId?: string | null;
  /** Artists get a round portrait, like the app's own avatars; a track's
   *  cover stays square, like every other cover art in the app. */
  round?: boolean;
}) {
  return (
    <span
      className="nav-glass"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px 6px 6px",
        borderRadius: 14,
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      {coverTrackId ? (
        <CollectionArt name={value} coverTrackId={coverTrackId} size={28} radius={7} round={round} />
      ) : (
        <span
          style={{
            display: "flex",
            flex: "none",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: round ? "50%" : 7,
            background: "rgba(255,255,255,.12)",
          }}
        >
          <StarIcon size={13} style={{ color: "var(--color-nav-action)" }} />
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span style={{ ...EYEBROW, display: "block", fontSize: 9.5 }}>{label}</span>
        <span
          className="nav-clip"
          style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginTop: 1, maxWidth: 140 }}
        >
          {value}
        </span>
      </span>
    </span>
  );
}

/**
 * A playlist, as a compact row — small square cover, name and subtitle, a
 * static chevron. This page's playlists are a handful sat under a profile
 * that already spent its width on the banner above, not a shelf of their
 * own: the reference's own "Playlists" section is rows for exactly that
 * reason, and rebuilding `HomeView`'s cover-forward shelf card here would be
 * the wrong shape wearing the right cover art.
 */
function PlaylistRow({
  playlist,
  subtitle,
  index,
  onOpen,
}: {
  playlist: Playlist;
  subtitle: React.ReactNode;
  index: number;
  onOpen: () => void;
}) {
  return (
    <button
      className="nav-press nav-row-in"
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      style={
        {
          "--i": index,
          display: "flex",
          alignItems: "center",
          gap: 12,
          textAlign: "left",
          minWidth: 0,
        } as React.CSSProperties
      }
    >
      <CollectionArt
        name={playlist.name}
        coverTrackId={playlist.cover_track_id}
        src={api.playlistArtworkUrl(playlist)}
        size={48}
        radius={10}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          className="nav-clip"
          style={{ display: "block", fontSize: 14, fontWeight: 600 }}
        >
          {playlist.name}
        </span>
        <span
          className="nav-clip"
          style={{ display: "block", fontSize: 11.5, color: "var(--color-nav-muted)", marginTop: 1 }}
        >
          {subtitle}
        </span>
      </span>
      <ChevronRightIcon size={14} style={{ flex: "none", opacity: 0.4 }} />
    </button>
  );
}
