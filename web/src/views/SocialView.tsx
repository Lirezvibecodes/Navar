import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Avatar } from "../components/Avatar";
import { CollectionArt } from "../components/PixelArt";
import { ActionButton, Empty, Screen, SectionHeader, Skeleton } from "../components/ui";
import { UserCheckIcon, UserPlusIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { formatAge, personName, trackTitle } from "../lib/format";
import { haptic, onActivationChange, shareLink } from "../telegram";
import type { ActivityItem, Person } from "../types";

/**
 * People.
 *
 * Who is playing something right now, what the people you know have been
 * doing, who is waiting on you, and the person behind a name you were given.
 * A section with no data behind it renders nothing at all rather than an empty
 * frame — most of this screen is blank on the first day and that is correct.
 *
 * Everything in the feed comes from one call. A row never names somebody you
 * cannot already see: the server leaves that name out, and this file has no
 * branch for it, because the safest version of that rule is the one the client
 * cannot get wrong.
 */
/** The one scheduled refetch in the app. See the effect that owns it. */
const ACTIVITY_REFRESH_MS = 30_000;
export function SocialView({ nav }: { nav: Navigation }) {
  const { toast } = useToast();
  const { me } = useLibrary();
  const [friends, setFriends] = useState<Person[]>([]);
  const [incoming, setIncoming] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const load = useCallback(async () => {
    try {
      const [people, requests, feed] = await Promise.all([
        api.listFriends(),
        api.listFriendRequests(),
        api.socialActivity(),
      ]);
      setFriends(people);
      setIncoming(requests.incoming);
      setActivity(feed);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load your friends");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The only thing in Navaar that is fetched on a schedule.
   *
   * It runs while this screen is mounted, which is exactly while its tab is on
   * screen — leaving the tab unmounts it — and it skips any tick where the Mini
   * App is not the thing being looked at, because a suspended WebView that
   * wakes and fires six missed intervals at a sleeping free instance is the
   * traffic this app is shaped around avoiding. Thirty seconds is already
   * finer-grained than the ten-minute window the server ages a status out on;
   * asking faster would learn nothing.
   *
   * A failed refresh is silent. What is on screen stays on screen, and the
   * next tick is thirty seconds away.
   */
  useEffect(() => {
    let onScreen = true;
    const stop = onActivationChange((active) => {
      onScreen = active;
    });
    const timer = window.setInterval(() => {
      if (!onScreen || document.hidden) return;
      api
        .socialActivity()
        .then(setActivity)
        .catch(() => undefined);
    }, ACTIVITY_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      stop();
    };
  }, []);

  const accept = async (person: Person) => {
    setIncoming((rows) =>
      rows.filter((r) => r.telegram_user_id !== person.telegram_user_id)
    );
    setFriends((rows) => [person, ...rows]);
    try {
      await api.acceptFriend(person.telegram_user_id);
      haptic.success();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not accept that");
      void load();
    }
  };

  /**
   * Look up the exact name somebody gave you.
   *
   * Exact, and one result: this is following a name you were handed, not
   * browsing the membership. The two answers that are not a stranger — it is
   * you, or it is already a friend — are said plainly rather than dropped into
   * the list, because both are cases where tapping Add would be the wrong move.
   */
  const find = async () => {
    const handle = query.trim().replace(/^@+/, "");
    if (handle.length === 0) return;
    try {
      const person = await api.findPersonByHandle(handle);
      if (me && Number(person.telegram_user_id) === me.id) {
        toast("That is you");
        return;
      }
      haptic.tap();
      setFound(person);
      setQuery("");
    } catch (err) {
      setFound(null);
      toast(err instanceof Error ? err.message : "Nobody by that name");
    }
  };

  const invite = async () => {
    try {
      const link = await api.friendInviteLink();
      if (!shareLink(link, "Add me on Navaar")) toast(link);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not make an invite link");
    }
  };

  if (loading) {
    return (
      <Screen>
        <Skeleton rows={4} />
      </Screen>
    );
  }

  const listening = activity.filter((row) => row.kind === "listening");
  const feed = activity.filter((row) => row.kind !== "listening");

  const alreadyFriends =
    found != null &&
    friends.some((f) => f.telegram_user_id === found.telegram_user_id);

  return (
    <Screen>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void find()}
          placeholder="Find someone by name"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="nav-glass"
          style={{
            flex: 1,
            minWidth: 0,
            height: 38,
            borderRadius: 19,
            padding: "0 14px",
            fontSize: 13,
            color: "#fff",
            border: 0,
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <ActionButton
          grow={false}
          disabled={query.trim().length === 0}
          onClick={() => void find()}
        >
          Find
        </ActionButton>
      </div>

      {found ? (
        <>
          <SectionHeader title="Found" spaceAbove={16} />
          <PersonRow
            person={found}
            index={0}
            onOpen={() =>
              nav.push({ type: "profile", userId: Number(found.telegram_user_id) })
            }
            action={
              alreadyFriends ? undefined : (
                <AddFriendButton userId={found.telegram_user_id} onDone={load} />
              )
            }
          />
        </>
      ) : null}

      {incoming.length > 0 ? (
        <>
          <SectionHeader title="Waiting on you" spaceAbove={16} />
          {incoming.map((person, i) => (
            <PersonRow
              key={person.telegram_user_id}
              person={person}
              index={i}
              onOpen={() =>
                nav.push({ type: "profile", userId: Number(person.telegram_user_id) })
              }
              action={
                <ActionButton grow={false} onClick={() => void accept(person)}>
                  Accept
                </ActionButton>
              }
            />
          ))}
        </>
      ) : null}

      {listening.length > 0 ? (
        <>
          <SectionHeader title="Listening now" spaceAbove={22} />
          <div className="nav-shelf" style={{ gap: 12 }}>
            {listening.map((row, i) => (
              <button
                key={row.person.telegram_user_id}
                className="nav-press nav-row-in"
                onClick={() => {
                  haptic.tap();
                  nav.push({
                    type: "profile",
                    userId: Number(row.person.telegram_user_id),
                  });
                }}
                style={
                  {
                    "--i": i,
                    width: 64,
                    flex: "none",
                    textAlign: "center",
                  } as React.CSSProperties
                }
              >
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Avatar
                    userId={row.person.telegram_user_id}
                    username={row.person.handle ?? row.person.username}
                    hasAvatar={row.person.has_avatar}
                    size={52}
                    ring
                  />
                </div>
                <span
                  className="nav-clip"
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    marginTop: 6,
                  }}
                >
                  {personName(row.person)}
                </span>
                <span
                  className="nav-clip"
                  style={{
                    display: "block",
                    fontSize: 10.5,
                    color: "var(--color-nav-muted)",
                  }}
                >
                  {row.track ? trackTitle(row.track) : ""}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {feed.length > 0 ? (
        <>
          <SectionHeader title="Going around" spaceAbove={22} />
          {feed.map((item, i) => (
            <ActivityRow
              key={item.kind + item.person.telegram_user_id + item.at}
              item={item}
              index={i}
              onOpen={() => {
                if (item.kind === "shared" && item.playlist) {
                  nav.push({ type: "playlist", id: item.playlist.id });
                  return;
                }
                nav.push({
                  type: "profile",
                  userId: Number(item.person.telegram_user_id),
                });
              }}
            />
          ))}
        </>
      ) : null}

      <SectionHeader
        title="Friends"
        action="Invite"
        onAction={() => void invite()}
        spaceAbove={
          incoming.length > 0 || found || listening.length > 0 || feed.length > 0
            ? 22
            : 16
        }
      />

      {friends.length === 0 ? (
        <Empty
          title="Nobody here yet"
          body="Send someone your invite link. Once they add you, what each of you shares shows up on the other's Home."
          action="Invite a friend"
          onAction={() => void invite()}
        />
      ) : (
        friends.map((person, i) => (
          <PersonRow
            key={person.telegram_user_id}
            person={person}
            index={i}
            onOpen={() =>
              nav.push({ type: "profile", userId: Number(person.telegram_user_id) })
            }
          />
        ))
      )}
    </Screen>
  );
}

/**
 * One thing that happened.
 *
 * A save carries two people — whoever kept the track and whoever they got it
 * from — and the second is here only if the server sent it. It leaves that
 * name out for anybody the viewer cannot already see, so there is no branch
 * here deciding whether a stranger may be introduced: the row simply says less.
 */
function ActivityRow({
  item,
  index,
  onOpen,
}: {
  item: ActivityItem;
  index: number;
  onOpen: () => void;
}) {
  const title = item.playlist
    ? item.playlist.name
    : item.track
      ? trackTitle(item.track)
      : "Something";
  const verb = item.kind === "shared" ? "shared a playlist" : "saved a track";
  const credit = item.from ? " · from " + personName(item.from) : "";

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
          gap: 11,
          width: "100%",
          minHeight: 56,
          textAlign: "left",
        } as React.CSSProperties
      }
    >
      <CollectionArt
        name={title}
        coverTrackId={item.playlist?.cover_track_id ?? item.track?.cover_track_id}
        src={item.playlist ? api.playlistArtworkUrl(item.playlist) : null}
        size={42}
        radius={9}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          className="nav-clip"
          style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}
        >
          {title}
        </span>
        <span
          className="nav-clip"
          style={{
            display: "block",
            fontSize: 11,
            color: "var(--color-nav-muted)",
            marginTop: 2,
          }}
        >
          {personName(item.person)} {verb}
          {credit}
        </span>
      </span>
      <Avatar
        userId={item.person.telegram_user_id}
        username={item.person.handle ?? item.person.username}
        hasAvatar={item.person.has_avatar}
        size={26}
      />
      <span
        style={{ fontSize: 10.5, color: "var(--color-nav-faint)", flex: "none" }}
      >
        {formatAge(item.at)}
      </span>
    </button>
  );
}

/** One person: 40px face, their name, and whatever the section needs on the end. */
function PersonRow({
  person,
  index,
  onOpen,
  action,
}: {
  person: Person;
  index: number;
  onOpen: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="nav-row-in"
      style={
        {
          "--i": index,
          display: "flex",
          alignItems: "center",
          gap: 11,
          minHeight: 52,
        } as React.CSSProperties
      }
    >
      <button
        className="nav-press"
        onClick={() => {
          haptic.tap();
          onOpen();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          flex: 1,
          minWidth: 0,
          minHeight: 52,
          textAlign: "left",
        }}
      >
        <Avatar
          userId={person.telegram_user_id}
          username={person.handle ?? person.username}
          hasAvatar={person.has_avatar}
          size={40}
        />
        <span className="nav-clip" style={{ fontSize: 13, fontWeight: 600 }}>
          {personName(person)}
        </span>
      </button>
      {action ?? (
        <UserCheckIcon
          size={16}
          style={{ color: "rgba(255,255,255,.3)", flex: "none" }}
        />
      )}
    </div>
  );
}

/** Exported so the profile screen can offer the same button. */
export function AddFriendButton({
  userId,
  onDone,
}: {
  userId: string | number;
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<"idle" | "sent">("idle");

  if (state === "sent") {
    return (
      <ActionButton grow={false} disabled onClick={() => undefined}>
        Pending
      </ActionButton>
    );
  }

  return (
    <ActionButton
      grow={false}
      icon={UserPlusIcon}
      onClick={() => {
        void api
          .addFriend(userId)
          .then(() => {
            setState("sent");
            haptic.success();
            onDone?.();
          })
          .catch((err: unknown) =>
            toast(err instanceof Error ? err.message : "Could not send that request")
          );
      }}
    >
      Add
    </ActionButton>
  );
}
