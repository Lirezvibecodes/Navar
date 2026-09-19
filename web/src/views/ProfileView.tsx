import * as api from "../api";
import type { Navigation } from "../App";
import { AddFriendButton } from "./SocialView";
import { Avatar } from "../components/Avatar";
import { CollectionArt } from "../components/PixelArt";
import { PersonTile } from "../components/PersonTile";
import {
  ActionButton,
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
  HeadphonesIcon,
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
import type { BadgeTier, ListeningStats } from "../types";

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
  const shared = !isMe && !known ? (profile?.playlists ?? []) : [];

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
        <Avatar
          userId={userId}
          username={isMe ? (me?.handle ?? me?.username) : (person?.handle ?? person?.username)}
          hasAvatar={isMe ? true : (person?.has_avatar ?? false)}
          size={76}
        />
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em" }}>
          {name}
        </span>
        {profile ? <TierChip tier={profile.tier} own={isMe} /> : null}
        {isMe ? (
          <span style={{ fontSize: 11.5, color: "var(--color-nav-muted)" }}>
            <Counted count={tracks.length} one="track" /> ·{" "}
            <Counted count={playlists.length} one="playlist" />
            {profile?.friend_count != null ? (
              <>
                {" "}
                · <Counted count={profile.friend_count} one="friend" many="friends" />
              </>
            ) : null}
          </span>
        ) : profile?.friend_count != null ? (
          <span style={{ fontSize: 11.5, color: "var(--color-nav-muted)" }}>
            <Counted count={profile.friend_count} one="friend" many="friends" />
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {isMe ? (
          <ActionButton icon={ShareIcon} onClick={() => void invite()}>
            Invite a friend
          </ActionButton>
        ) : (
          <>
            {known ? (
              <>
                <ActionButton
                  icon={LibraryIcon}
                  onClick={() => nav.push({ type: "friendLibrary", friendId: userId })}
                >
                  Their Library
                </ActionButton>
                <GhostButton onClick={() => void unfriend()}>Remove</GhostButton>
              </>
            ) : profile?.state === "pending_out" ? (
              <ActionButton disabled onClick={() => undefined}>
                Requested
              </ActionButton>
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

      {isMe ? (
        <>
          <SectionHeader title="Listening" />
          {hasStats(profile?.stats) ? (
            <StatsGrid stats={profile!.stats!} />
          ) : profile ? (
            <Empty title="Nothing yet" body="Play something and your stats will land here." />
          ) : null}

          <SectionHeader title="Your library" />
          <GhostButton
            icon={LibraryIcon}
            height={44}
            onClick={() => nav.push({ type: "crate", filter: "all" })}
          >
            Open The Crate
          </GhostButton>
          <GhostButton
            icon={SettingsIcon}
            height={44}
            onClick={() => nav.push({ type: "settings" })}
          >
            Settings
          </GhostButton>
        </>
      ) : (
        <>
          {known && hasStats(profile?.stats) ? (
            <>
              <SectionHeader title="Listening" />
              <StatsGrid stats={profile!.stats!} />
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

          {/* What somebody you are not connected to has published to anyone.
              A friend gets the dedicated screen above instead, which is the
              same list with room to breathe. */}
          {shared.length > 0 ? (
            <>
              <SectionHeader title="Shared with everyone" />
              {shared.map((playlist, i) => (
                <button
                  key={playlist.id}
                  className="nav-press nav-row-in"
                  onClick={() => {
                    haptic.tap();
                    nav.push({ type: "playlist", id: playlist.id, name: playlist.name });
                  }}
                  style={
                    {
                      "--i": i,
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      width: "100%",
                      minHeight: 58,
                      textAlign: "left",
                    } as React.CSSProperties
                  }
                >
                  <CollectionArt
                    name={playlist.name}
                    coverTrackId={playlist.cover_track_id}
                    src={api.playlistArtworkUrl(playlist)}
                    size={44}
                    radius={9}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      className="nav-clip"
                      style={{ display: "block", fontSize: 13, fontWeight: 600 }}
                    >
                      {playlist.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--color-nav-muted)",
                        marginTop: 2,
                      }}
                    >
                      <Counted count={playlist.track_count ?? 0} one="track" />
                    </span>
                  </span>
                  <ChevronRightIcon
                    size={15}
                    style={{ color: "var(--color-nav-faint)", flex: "none" }}
                  />
                </button>
              ))}
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

/** Whether there is anything at all to draw a `StatsGrid` from. */
function hasStats(stats: ListeningStats | null | undefined): stats is ListeningStats {
  return !!stats && (stats.totalListenedSeconds > 0 || stats.totalPlays > 0);
}

/**
 * What this person has been into: how long, lately how much, and the top of
 * it — as cards rather than a line of text, so a number people have actually
 * earned reads like one.
 *
 * The hero card is the lifetime total rather than the 90-day play count,
 * because `plays` is retention-pruned (see `recordPlay`) and a longtime
 * listener whose recent window happens to be quiet still deserves something
 * to show for themselves. The recent-activity tiles only appear once there is
 * a window to report on.
 */
function StatsGrid({ stats }: { stats: ListeningStats }) {
  const hasRecent = stats.totalPlays > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 14 }}>
      {stats.totalListenedSeconds > 0 ? (
        <div
          className="nav-row-in"
          style={
            {
              "--i": 0,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 16px",
              borderRadius: 18,
              background: "linear-gradient(110deg, var(--color-nav-action), #89aeff)",
              boxShadow: "0 10px 26px rgba(0,0,0,.4)",
              color: "#0A0A0A",
            } as React.CSSProperties
          }
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              flex: "none",
              width: 42,
              height: 42,
              borderRadius: 21,
              background: "rgba(10,10,10,.13)",
            }}
          >
            <HeadphonesIcon size={19} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ ...EYEBROW, display: "block", color: "rgba(10,10,10,.58)" }}>
              Lifetime listening
            </span>
            <span
              className="nav-display"
              style={{ display: "block", fontSize: 21, lineHeight: 1.2, marginTop: 2 }}
            >
              {formatListened(stats.totalListenedSeconds)}
            </span>
          </span>
        </div>
      ) : null}

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
            index={1}
            value={<Counted count={stats.totalPlays} one="play" many="plays" />}
            caption="last 90 days"
          />
          {stats.topArtist ? (
            <StatTile icon={StarIcon} index={2} value={stats.topArtist} caption="most played" />
          ) : null}
        </div>
      ) : null}
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
