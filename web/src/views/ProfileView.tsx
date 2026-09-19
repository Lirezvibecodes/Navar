import * as api from "../api";
import type { Navigation } from "../App";
import { AddFriendButton } from "./SocialView";
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
  Skeleton,
} from "../components/ui";
import {
  BoltIcon,
  ChevronRightIcon,
  type IconProps,
  LibraryIcon,
  SettingsIcon,
  ShareIcon,
  StarIcon,
} from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { cacheKey, dropCache, ttl, useCached } from "../lib/cache";
import { formatListened, personName } from "../lib/format";
import { haptic, shareLink } from "../telegram";
import type { ActivityTrack, BadgeTier, ListeningStats, Playlist } from "../types";

/**
 * One person's page — yours or somebody else's.
 *
 * There is one screen rather than two because the difference between them is
 * only which affordances are live: your own page offers an invite link and
 * counts drawn from the library already in memory, and someone else's offers
 * the relationship. Everything else — where you stand, what they have earned,
 * and whatever of theirs you are allowed to open — arrives in a single call
 * that is already scoped to you, so nothing on this page decides who may see
 * what.
 */
export function ProfileView({ nav, userId }: { nav: Navigation; userId: number }) {
  const { me, tracks, playlists } = useLibrary();
  const { toast, errorToast } = useToast();

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

  const invite = async () => {
    try {
      const link = await api.friendInviteLink();
      if (!shareLink(link, "Add me on Navaar")) toast(link);
    } catch (err) {
      errorToast(err, "Could not make an invite link");
    }
  };

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

  // The meta line under the name: whatever counts this viewer is owed, joined
  // into one sentence-case sentence rather than a row of separate chips —
  // that is the one line the reference's banner spends on stats, so it is the
  // one place the numbers this page has to show actually live.
  const metaParts: React.ReactNode[] = [];
  if (isMe) {
    metaParts.push(<Counted key="tracks" count={tracks.length} one="track" />);
    metaParts.push(<Counted key="playlists" count={playlists.length} one="playlist" />);
  }
  if (profile?.friend_count != null) {
    metaParts.push(
      <Counted key="friends" count={profile.friend_count} one="friend" many="friends" />
    );
  }
  if (stats && stats.totalListenedSeconds > 0) {
    metaParts.push(<span key="listened">{formatListened(stats.totalListenedSeconds)} listened</span>);
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

        <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
          {isMe ? (
            <>
              <GhostButton icon={ShareIcon} onClick={() => void invite()}>
                Invite a friend
              </GhostButton>
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

      {isMe ? (
        <>
          {hasStats(stats) ? (
            <>
              <SectionHeader title="Listening" spaceAbove={20} />
              <StatsGrid stats={stats} />
            </>
          ) : profile ? (
            <>
              <SectionHeader title="Listening" spaceAbove={20} />
              <Empty title="Nothing yet" body="Play something and your stats will land here." />
            </>
          ) : null}

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
          {hasStats(stats) ? (
            <>
              <SectionHeader title="Listening" spaceAbove={20} />
              <StatsGrid stats={stats} />
            </>
          ) : null}

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
 * Whether there is anything at all to draw a `StatsGrid` from.
 *
 * Lifetime listening is no longer this grid's business — it moved into the
 * banner's own meta line — so the grid itself only needs to exist once there
 * is a recent window or a most-played track to show.
 */
function hasStats(stats: ListeningStats | null | undefined): stats is ListeningStats {
  return !!stats && (stats.totalPlays > 0 || !!stats.topTrack);
}

/**
 * What this person has been into lately, and the top of it — as glass tiles
 * rather than a line of text, so a number people have actually earned reads
 * like one. No hero card here any more: a flat gradient slab was the exact
 * "AI slop" the reference was called in against, and the one number worth a
 * hero treatment (lifetime listening) already lives in the banner above.
 */
function StatsGrid({ stats }: { stats: ListeningStats }) {
  const hasRecent = stats.totalPlays > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 14 }}>
      {hasRecent ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: stats.topArtist ? "1fr 1fr" : "1fr",
            gap: 10,
          }}
        >
          <StatTile
            icon={BoltIcon}
            index={0}
            value={<Counted count={stats.totalPlays} one="play" many="plays" />}
            caption="last 90 days"
          />
          {stats.topArtist ? (
            <StatTile icon={StarIcon} index={1} value={stats.topArtist} caption="most played" />
          ) : null}
        </div>
      ) : null}

      {stats.topTrack ? <TopTrackTile track={stats.topTrack} index={2} /> : null}
    </div>
  );
}

/**
 * The one stat that isn't a number — the actual track behind "most played",
 * with its own art. The plays/artist tiles above say how much and who; this
 * says what, which is the part a number can't carry on its own.
 */
function TopTrackTile({ track, index }: { track: ActivityTrack; index: number }) {
  return (
    <div
      className="nav-glass nav-row-in"
      style={
        {
          "--i": index,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 13px",
          borderRadius: 16,
        } as React.CSSProperties
      }
    >
      <CollectionArt
        name={track.title ?? "Untitled"}
        coverTrackId={track.cover_track_id}
        size={42}
        radius={10}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...EYEBROW, display: "block" }}>Most played track</span>
        <span
          className="nav-clip"
          style={{ display: "block", fontSize: 13, fontWeight: 600, marginTop: 2 }}
        >
          {track.title ?? "Untitled"}
        </span>
        {track.artist ? (
          <span
            className="nav-clip"
            style={{ display: "block", fontSize: 11, color: "var(--color-nav-muted)", marginTop: 1 }}
          >
            {track.artist}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** One glass tile in the `StatsGrid` — an icon, a headline value, a caption. */
function StatTile({
  icon: Icon,
  index,
  value,
  caption,
}: {
  icon: (props: IconProps) => React.ReactNode;
  index: number;
  value: React.ReactNode;
  caption: string;
}) {
  return (
    <div
      className="nav-glass nav-row-in"
      style={
        {
          "--i": index,
          display: "flex",
          flexDirection: "column",
          gap: 7,
          padding: "12px 13px",
          borderRadius: 16,
          minWidth: 0,
        } as React.CSSProperties
      }
    >
      <Icon size={15} style={{ color: "var(--color-nav-action)" }} />
      <span className="nav-clip" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: "var(--color-nav-muted)" }}>{caption}</span>
    </div>
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
