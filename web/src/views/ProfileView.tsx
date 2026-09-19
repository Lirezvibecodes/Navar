import { useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { AddFriendButton, PersonRow } from "./SocialView";
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
  Skeleton,
} from "../components/ui";
import {
  ChevronRightIcon,
  HeadphonesIcon,
  LibraryIcon,
  LockIcon,
  StarIcon,
  UserIcon,
} from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { cacheKey, dropCache, ttl, useCached } from "../lib/cache";
import { formatListened, personName } from "../lib/format";
import { drawPixelatedWash } from "../lib/pixelWash";
import { loadImage } from "../lib/storyCard";
import { confirmAction, haptic } from "../telegram";
import type { BadgeTier, ListeningStats, Person, Playlist } from "../types";

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
export function usePixelatedBanner(coverUrl: string | null): string | null {
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
 * The dark scrim + pixelated cover behind a profile header — `ProfileView`
 * and the Settings screen that edits the same background both paint one of
 * these into an absolutely-positioned, `aria-hidden` layer.
 *
 * The page underneath is never a flat colour — `.nav-screen-bg` is a noise
 * texture under two tinted radial gradients — so a scrim that ends on an
 * opaque, colour-matched pixel still shows a seam the moment the real
 * background differs from the guess by even a shade. `.nav-profile-banner`'s
 * own CSS fallback (shown with no chosen cover) never had this problem
 * because it fades to fully transparent instead of to a matched colour; this
 * masks the whole layer — image and scrim together — the same way, so
 * whatever is actually behind it shows through on its own terms.
 */
export function bannerLayerStyle(bannerUrl: string): React.CSSProperties {
  const fade = "linear-gradient(180deg, #000 0%, #000 78%, transparent 100%)";
  return {
    position: "absolute",
    inset: 0,
    background: `linear-gradient(180deg, rgba(3,3,3,.55), rgba(3,3,3,.74) 55%, rgba(3,3,3,.9) 82%, rgba(3,3,3,.96)), url(${bannerUrl}) center/cover no-repeat`,
    WebkitMaskImage: fade,
    maskImage: fade,
  };
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
  const { me, playlists } = useLibrary();
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

  const [friendsOpen, setFriendsOpen] = useState(false);
  const [tierOpen, setTierOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const unfriend = async () => {
    if (!(await confirmAction(`Remove ${name} from your friends?`))) return;
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

  // The header's photo defaults to the owner's most-played track and can be
  // overridden with any cover from their own library — an override on a
  // computed default, the same shape `playlists.cover_track_id` already is.
  const bgTrackId = profile?.background_track_id ?? profile?.stats?.topTrack?.cover_track_id ?? null;
  const bannerUrl = usePixelatedBanner(bgTrackId ? api.trackCoverUrl(bgTrackId, userId) : null);

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

  return (
    <Screen scrollKey={`profile:${userId}`}>
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
        {bannerUrl ? <div aria-hidden style={bannerLayerStyle(bannerUrl)} /> : null}

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar
              userId={userId}
              username={isMe ? (me?.handle ?? me?.username) : (person?.handle ?? person?.username)}
              hasAvatar={isMe ? true : (person?.has_avatar ?? false)}
              size={84}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className="nav-clip nav-display"
                  style={{
                    display: "block",
                    flex: "0 1 auto",
                    minWidth: 0,
                    fontSize: 25,
                    lineHeight: 1.15,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {name}
                </span>
                {profile ? (
                  <TierChip tier={profile.tier} own={isMe} onClick={() => setTierOpen(true)} />
                ) : null}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginTop: 6,
                  flexWrap: "wrap",
                }}
              >
                {profile?.friend_count != null ? (
                  <FriendsChip count={profile.friend_count} onClick={() => setFriendsOpen(true)} />
                ) : null}
                {stats && stats.totalListenedSeconds > 0 ? (
                  <ListenChip seconds={stats.totalListenedSeconds} onClick={() => setStatsOpen(true)} />
                ) : null}
              </div>

              {/* Favourite track and favourite artist, directly under the
                  friends/listen row and sharing its left edge — the same
                  column, one row down, rather than a separate hero-sized
                  block of their own. Side by side, each hugging its own
                  content width (not forced into an even half-and-half
                  split) so a short pair sits close together instead of
                  stretching a gap between them. */}
              {stats?.topTrack || stats?.topArtist ? (
                <div style={{ display: "flex", alignItems: "stretch", marginTop: 7, minWidth: 0 }}>
                  {stats.topTrack ? (
                    <FavoriteChip
                      label="Top track"
                      value={stats.topTrack.title ?? "Untitled"}
                      coverTrackId={stats.topTrack.cover_track_id}
                      profileUserId={userId}
                    />
                  ) : null}
                  {stats.topArtist ? (
                    <FavoriteChip
                      label="Top artist"
                      value={stats.topArtist.name}
                      coverTrackId={stats.topArtist.cover_track_id}
                      profileUserId={userId}
                      divider={Boolean(stats.topTrack)}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {!isMe ? (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
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
            </div>
          ) : null}
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

      <FriendsSheet
        nav={nav}
        userId={userId}
        name={name}
        open={friendsOpen}
        onClose={() => setFriendsOpen(false)}
      />
      {profile ? (
        <TierSheet
          tier={profile.tier}
          own={isMe}
          name={name}
          open={tierOpen}
          onClose={() => setTierOpen(false)}
        />
      ) : null}
      {stats ? (
        <ListenSheet
          stats={stats}
          profileUserId={userId}
          open={statsOpen}
          onClose={() => setStatsOpen(false)}
        />
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
 *
 * Tapping it raises `TierSheet` — the full ladder, not just the one word this
 * chip has room for.
 */
function TierChip({
  tier,
  own,
  onClick,
}: {
  tier: BadgeTier;
  own: boolean;
  onClick: () => void;
}) {
  if (tier.min === 0 && !own) return null;
  return (
    <button
      className="nav-glass nav-press"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      style={{
        display: "inline-flex",
        flexShrink: 0,
        alignItems: "center",
        gap: 3,
        height: 18,
        padding: "0 7px",
        borderRadius: 9,
        fontSize: 9,
        fontWeight: 600,
        color: "#fff",
      }}
    >
      <StarIcon size={9} />
      {tier.label}
    </button>
  );
}

/**
 * Who somebody knows, worn beside the tier chip and in the exact spot the
 * tag used to sit — bolder than the tier chip it replaces there (800 weight,
 * solid glass rather than a thin outline) because unlike the tier this one
 * opens something: tapping it raises `FriendsSheet`. It only ever renders
 * when the profile response actually carried a `friend_count`, which is the
 * same self-or-friend visibility rule the backend's `/:id/friends` route
 * re-checks before answering, so there is nothing to gate here beyond that.
 */
function FriendsChip({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      className="nav-glass nav-press"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 24,
        padding: "0 10px 0 9px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 800,
        color: "#fff",
      }}
    >
      <UserIcon size={11} />
      <Counted count={count} one="friend" many="friends" />
    </button>
  );
}

/**
 * The list a `FriendsChip` opens — same rows as the Social tab's own friends
 * list (`PersonRow`, exported from `SocialView`), fetched fresh on every
 * open rather than cached, since it's somebody else's list rather than the
 * viewer's own and isn't worth a cache key of its own.
 */
function FriendsSheet({
  nav,
  userId,
  name,
  open,
  onClose,
}: {
  nav: Navigation;
  userId: number;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<Person[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFriends(null);
    void api.listUserFriends(userId).then((list) => {
      if (!cancelled) setFriends(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  return (
    <Sheet open={open} onClose={onClose} title={`${name}'s friends`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 12px 10px" }}>
        {friends === null ? (
          <Skeleton rows={4} />
        ) : friends.length === 0 ? (
          <Empty title="No friends yet" body="Nobody has connected with them yet." />
        ) : (
          friends.map((friend, i) => (
            <PersonRow
              key={friend.telegram_user_id}
              person={friend}
              index={i}
              onOpen={() => {
                onClose();
                nav.push({ type: "profile", userId: Number(friend.telegram_user_id) });
              }}
            />
          ))
        )}
      </div>
    </Sheet>
  );
}

/**
 * Mirrors `server/src/badges.ts`'s `BADGE_TIERS` — a static rule table, the
 * same for everyone, so showing its thresholds here is not the same as
 * showing anybody's actual endorsement count. That count never leaves the
 * server (see `getUserProfile`'s own comment); unlocked/locked below is
 * decided from `tier.min` alone. Because `tierFor` only ever moves up, a
 * ladder rung is unlocked exactly when its threshold sits at or below the
 * tier already on the profile — no count needed.
 */
const TIER_LADDER: ReadonlyArray<{ id: string; label: string; min: number }> = [
  { id: "listener", label: "Listener", min: 0 },
  { id: "selector", label: "Selector", min: 1 },
  { id: "tastemaker", label: "Tastemaker", min: 5 },
  { id: "curator", label: "Curator", min: 15 },
];

/**
 * The full ladder a `TierChip` opens: what's been reached, and what it takes
 * to reach what hasn't. Locked rungs sit visibly dimmer with a lock glyph in
 * place of the star — the "darker, with an explanation" the tag panel asked
 * for — and the endorsement mechanic itself is explained once, above the
 * locked list, rather than repeated in every row's copy.
 */
function TierSheet({
  tier,
  own,
  name,
  open,
  onClose,
}: {
  tier: BadgeTier;
  own: boolean;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const subject = own ? "You" : name;
  const taste = own ? "your taste" : `${name}’s taste`;
  const unlocked = TIER_LADDER.filter((t) => t.min <= tier.min);
  const locked = TIER_LADDER.filter((t) => t.min > tier.min);

  return (
    <Sheet open={open} onClose={onClose} title="Tiers">
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "2px 14px 16px" }}>
        <span style={{ ...EYEBROW, fontSize: 10 }}>Unlocked</span>
        {unlocked.map((t) => (
          <TierRow
            key={t.id}
            label={t.label}
            locked={false}
            copy={t.min === 0 ? "Everyone starts here." : `${subject} reached this once ${t.min}+ people endorsed ${taste}.`}
          />
        ))}

        {locked.length > 0 ? (
          <>
            <span style={{ ...EYEBROW, fontSize: 10, marginTop: 10 }}>Locked</span>
            <p style={{ margin: "-2px 2px 2px", fontSize: 11.5, lineHeight: 1.5, color: "var(--color-nav-muted)" }}>
              {own
                ? "Somebody can endorse your taste once they've kept a track they got from you — a record of music that travelled, not a popularity count."
                : `Somebody can endorse ${taste} once they've kept a track they got from ${name}.`}
            </p>
            {locked.map((t) => (
              <TierRow key={t.id} label={t.label} locked copy={`Reached once ${t.min}+ people endorse ${taste}.`} />
            ))}
          </>
        ) : (
          <Empty
            title="Every tier unlocked"
            body={own ? "You've reached the top of the ladder." : `${name} has reached the top of the ladder.`}
          />
        )}
      </div>
    </Sheet>
  );
}

function TierRow({ label, copy, locked }: { label: string; copy: string; locked: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 11px",
        borderRadius: 12,
        background: locked ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.07)",
        opacity: locked ? 0.55 : 1,
      }}
    >
      <span
        style={{
          display: "flex",
          flex: "none",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 8,
          background: locked ? "rgba(255,255,255,.06)" : "var(--color-nav-action)",
          color: locked ? "rgba(255,255,255,.4)" : "#0A0A0A",
        }}
      >
        {locked ? <LockIcon size={12} /> : <StarIcon size={12} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: locked ? "rgba(255,255,255,.55)" : "#fff" }}>
          {label}
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--color-nav-muted)", marginTop: 2 }}>
          {copy}
        </div>
      </div>
    </div>
  );
}

/**
 * Lifetime listening, worn as its own lime pill next to the tier chip rather
 * than folded into the grey meta sentence below the name — the same "earned
 * number deserves its own weight" treatment the tier chip already gets, on
 * the app's one accent colour instead of glass so it actually reads as a
 * highlight and not another line of muted text.
 *
 * Tapping it raises `ListenSheet` — the abbreviated number here is a summary,
 * not the whole picture.
 */
function ListenChip({ seconds, onClick }: { seconds: number; onClick: () => void }) {
  return (
    <button
      className="nav-press"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
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
    </button>
  );
}

/**
 * What `ListenChip` opens: the lifetime total in full, plus the ranked top 3
 * tracks and artists that number is made of — the same ranking `topTrack`/
 * `topArtist` are drawn from, just not cut down to one each. Researched
 * against how music apps close this loop (Spotify Wrapped, Last.fm's own
 * profile): a hero number up top, then ranked lists with a play count next
 * to each entry rather than a wall of unlabeled bars — the count is the one
 * piece of context that makes "why is this #1" legible at a glance.
 */
function ListenSheet({
  stats,
  profileUserId,
  open,
  onClose,
}: {
  stats: ListeningStats;
  profileUserId: number;
  open: boolean;
  onClose: () => void;
}) {
  const hours = Math.floor(stats.totalListenedSeconds / 3600);
  const minutes = Math.floor((stats.totalListenedSeconds % 3600) / 60);

  return (
    <Sheet open={open} onClose={onClose} title="Listening stats">
      <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: "4px 14px 18px" }}>
        <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
          <div
            className="nav-numeral"
            style={{ fontSize: 42, fontWeight: 700, lineHeight: 1, color: "var(--color-nav-action)" }}
          >
            {hours > 0 ? (
              <>
                {hours}
                <span style={{ fontSize: 20 }}>h</span> {minutes}
                <span style={{ fontSize: 20 }}>m</span>
              </>
            ) : (
              <>
                {minutes}
                <span style={{ fontSize: 20 }}>m</span>
              </>
            )}
          </div>
          <div style={{ ...EYEBROW, fontSize: 10, marginTop: 6 }}>Lifetime listening</div>
        </div>

        <StatRankSection
          label="Top tracks"
          items={stats.topTracks}
          profileUserId={profileUserId}
          renderTitle={(t) => t.title ?? "Untitled"}
          renderSubtitle={(t) => t.artist}
          coverOf={(t) => t.cover_track_id}
        />

        <StatRankSection
          label="Top artists"
          items={stats.topArtists}
          profileUserId={profileUserId}
          renderTitle={(a) => a.name}
          renderSubtitle={() => null}
          coverOf={(a) => a.cover_track_id}
        />
      </div>
    </Sheet>
  );
}

/** One ranked list inside `ListenSheet` — tracks and artists share the exact
 *  same row shape, so the two sections are one generic component rather than
 *  two near-identical copies. */
function StatRankSection<T extends { plays: number }>({
  label,
  items,
  profileUserId,
  renderTitle,
  renderSubtitle,
  coverOf,
}: {
  label: string;
  items: T[];
  profileUserId: number;
  renderTitle: (item: T) => string;
  renderSubtitle: (item: T) => string | null;
  coverOf: (item: T) => string | null;
}) {
  return (
    <div>
      <span style={{ ...EYEBROW, fontSize: 10 }}>{label}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {items.length === 0 ? (
          <Empty title="Nothing recent" body="Keep listening and this will fill in." />
        ) : (
          items.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                className="nav-numeral"
                style={{ flex: "none", width: 14, fontSize: 13, textAlign: "center", color: "var(--color-nav-muted)" }}
              >
                {i + 1}
              </span>
              {coverOf(item) ? (
                <CollectionArt
                  name={renderTitle(item)}
                  coverTrackId={coverOf(item)!}
                  src={api.trackCoverUrl(coverOf(item)!, profileUserId)}
                  size={38}
                  radius={7}
                />
              ) : (
                <span
                  style={{
                    display: "flex",
                    flex: "none",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 38,
                    height: 38,
                    borderRadius: 7,
                    background: "rgba(255,255,255,.08)",
                  }}
                >
                  <StarIcon size={14} style={{ color: "var(--color-nav-muted)" }} />
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nav-clip" style={{ fontSize: 13, fontWeight: 600 }}>
                  {renderTitle(item)}
                </div>
                {renderSubtitle(item) ? (
                  <div className="nav-clip" style={{ fontSize: 11, color: "var(--color-nav-muted)", marginTop: 1 }}>
                    {renderSubtitle(item)}
                  </div>
                ) : null}
              </div>
              <span style={{ flex: "none", fontSize: 11, color: "var(--color-nav-muted)" }}>
                <Counted count={item.plays} one="play" many="plays" />
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * A favourite, sitting in the header the way the count beside it does —
 * cover art (or a star, when even the artist's own tracks carry none) next
 * to a small-caps label and the value, with no pill of its own behind it.
 * A full glass card here read as a badge stapled onto the header; bare text
 * with no anchor at all read as nothing. The cover art already is a small,
 * bounded shape, so it carries the "contained" half of that tension by
 * itself — the second chip gets a hairline rule instead of its own box, the
 * same way two figures in one stat row are divided, not each boxed apart.
 * Both the track and the artist get the same square cover, like every other
 * cover art in the app — an artist has no more claim to a round portrait
 * here than a playlist or an album does.
 */
function FavoriteChip({
  label,
  value,
  coverTrackId,
  profileUserId,
  divider,
}: {
  label: string;
  value: string;
  coverTrackId?: string | null;
  profileUserId: number;
  divider?: boolean;
}) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        // Hugs its own content instead of a forced 1 1 0 (even 50/50) split —
        // that stretch was the gap the two chips sat behind. It can still
        // shrink and truncate its value when the pair together overflows.
        flex: "0 1 auto",
        minWidth: 0,
        paddingLeft: divider ? 10 : 0,
        marginLeft: divider ? 10 : 0,
        borderLeft: divider ? "1px solid rgba(255,255,255,.14)" : "none",
      }}
    >
      {coverTrackId ? (
        <CollectionArt
          name={value}
          coverTrackId={coverTrackId}
          src={api.trackCoverUrl(coverTrackId, profileUserId)}
          size={22}
          radius={5}
        />
      ) : (
        <span
          style={{
            display: "flex",
            flex: "none",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "rgba(255,255,255,.12)",
          }}
        >
          <StarIcon size={10} style={{ color: "var(--color-nav-action)" }} />
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span className="nav-clip" style={{ ...EYEBROW, display: "block", fontSize: 8 }}>
          {label}
        </span>
        <span
          className="nav-clip"
          style={{ display: "block", fontSize: 10.5, fontWeight: 600, marginTop: 0 }}
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
