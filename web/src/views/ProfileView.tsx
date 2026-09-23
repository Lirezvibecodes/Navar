import { useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { AddFriendButton, PersonRow } from "./SocialView";
import { Avatar } from "../components/Avatar";
import { CollectionArt } from "../components/PixelArt";
import { PersonTile } from "../components/PersonTile";
import { RankSection } from "../components/RankSection";
import { TagPlaque } from "../components/TagCard";
import { TagDetailSheet } from "../components/TagDetailSheet";
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
import type { EquippedTag, ListeningStats, Person, Playlist } from "../types";

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
 *
 * The fade is pinned to a fixed distance from the layer's own bottom edge
 * rather than a percentage of its height. A percentage measures from the top
 * of the box — which is mostly dead space reserved for the floating TopBar —
 * so as the header grows (a friend's action row, wrapped chips, a second
 * favourite) the same percentage lands at a different point relative to the
 * actual content, sometimes finishing the dissolve while a chip is still
 * sitting on it. Pinning to the bottom instead means the scrim stays at full
 * strength behind every row of real content — wherever that content ends —
 * and only ever dissolves within the padding below it, which is exactly the
 * blank margin this resolves into.
 */
export function bannerLayerStyle(bannerUrl: string): React.CSSProperties {
  const fade =
    "linear-gradient(180deg, #000 0%, #000 calc(100% - 28px), transparent 100%)";
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
  const { data: profile, loading } = useCached(
    cacheKey.profile(userId),
    () => api.getProfile(userId),
    ttl.profile
  );

  const [friendsOpen, setFriendsOpen] = useState(false);
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
          blurring TopBar the way that bar already documents content doing.

          Top and bottom padding are the same 28px once the TopBar's own
          reserved space is set aside (that space is invisible, painted over
          by the bar itself, so it doesn't count as breathing room). Equal
          padding on both sides of the content is what makes the header read
          as centred in its box instead of pinned to the top with a slab of
          leftover space underneath — and it hands `bannerLayerStyle` a
          bottom margin exactly as tall as its own fixed fade band, so the
          wash finishes dissolving precisely in the gap meant for it. */}
      <div
        className="nav-rise nav-profile-banner"
        style={{
          margin:
            "calc(-1 * (var(--nav-topbar-h) + var(--nav-top-inset) + 8px)) -14px 0",
          padding:
            "calc(var(--nav-topbar-h) + var(--nav-top-inset) + 28px) 16px 28px",
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
                {isMe ? <OwnPrimaryTag nav={nav} /> : <OtherPrimaryTag tags={profile?.equipped_tags ?? []} />}
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
                  <ListenChip
                    seconds={stats.totalListenedSeconds}
                    onClick={() => (isMe ? nav.push({ type: "stats" }) : setStatsOpen(true))}
                  />
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
 * The one pinned Navaar Tag shown beside the handle — the spot the old tier
 * chip used to sit before it was retired in favour of this. Sized to match
 * that old chip exactly (`TagPlaque`'s `small` variant: 18px tall, 9px type)
 * so replacing it didn't also mean resizing the header row around it. You
 * can still equip up to 3 (the Tags screen shows the rest), but this slot
 * only ever surfaces the first.
 *
 * Fetches `/api/tags` for itself (the same cache key `TagsView` reads, so
 * opening either one first makes the other instant). Tapping it is a
 * shortcut to the full Tags screen — the "progress page" — rather than a
 * quick-unequip affordance: unpinning or swapping which tag leads now always
 * happens there, where the other two equip slots and everything still locked
 * are visible too.
 */
function OwnPrimaryTag({ nav }: { nav: Navigation }) {
  const { data: tags } = useCached(cacheKey.tags, api.getTags, ttl.tags);

  const primary = (tags ?? []).find((t) => t.equipped);
  if (!primary) return null;

  return (
    <TagPlaque id={primary.id} name={primary.name} tier={primary.tier} onOpen={() => nav.push({ type: "tags" })} small />
  );
}

/**
 * The read-only twin of `OwnPrimaryTag`, for somebody else's profile: takes
 * the first entry of `equipped_tags` straight from `UserProfile` rather than
 * fetching anything of its own, and renders nothing when there is nothing
 * pinned. Tapping it raises `TagDetailSheet` read-only (`editable={false}`)
 * — a stranger's page shows what the tag is, never a way to change it. The
 * detail handed in is built with `unlocked: true` and no progress or unlock
 * date, because an `EquippedTag` carries none of that and a stranger's page
 * must never imply otherwise.
 */
function OtherPrimaryTag({ tags }: { tags: EquippedTag[] }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const primary = tags[0];
  if (!primary) return null;

  return (
    <>
      <TagPlaque id={primary.id} name={primary.name} tier={primary.tier} onOpen={() => setSheetOpen(true)} small />
      <TagDetailSheet
        tag={{ ...primary, unlocked: true, unlocked_at: null, progress: null, target: null }}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editable={false}
        equipped={false}
        canEquipMore={false}
      />
    </>
  );
}

/**
 * Who somebody knows — bolder than the tag chip beside it in the name row
 * (800 weight, solid glass rather than a thin outline) because unlike that
 * one this opens something: tapping it raises `FriendsSheet`. It only ever
 * renders when the profile response actually carried a `friend_count`,
 * which is the same self-or-friend visibility rule the backend's
 * `/:id/friends` route re-checks before answering, so there is nothing to
 * gate here beyond that.
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

        <RankSection
          label="Top tracks"
          items={stats.topTracks}
          profileUserId={profileUserId}
          renderTitle={(t) => t.title ?? "Untitled"}
          renderSubtitle={(t) => t.artist}
          coverOf={(t) => t.cover_track_id}
        />

        <RankSection
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
