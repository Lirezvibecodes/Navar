import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Avatar } from "../components/Avatar";
import { CollectionArt } from "../components/PixelArt";
import { PersonTile } from "../components/PersonTile";
import {
  ActionButton,
  Counted,
  Empty,
  Screen,
  SectionHeader,
  Skeleton,
  TextField,
} from "../components/ui";
import { UserCheckIcon, UserPlusIcon } from "../icons";
import { useToast } from "../context/ToastContext";
import {
  cached,
  cacheKey,
  dropCache,
  peek,
  revalidate,
  ttl,
} from "../lib/cache";
import { formatAge, namesList, personName, trackTitle } from "../lib/format";
import { haptic, onActivationChange, shareLink } from "../telegram";
import type { ActivityItem, Person, PersonResult, Suggestion } from "../types";

/**
 * People.
 *
 * Who is playing something right now, what the people you know have been
 * doing, who is waiting on you, and anybody you go looking for.
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

/**
 * How long the typing has to stop before the search is sent.
 *
 * Long enough that a name typed straight through costs one request rather than
 * one per letter, short enough that it still feels like the list is following
 * along. The server ignores anything shorter than two characters, so the first
 * keystroke never leaves the phone at all.
 */
const SEARCH_DEBOUNCE_MS = 250;

export function SocialView({ nav }: { nav: Navigation }) {
  const { toast, errorToast } = useToast();
  // Seeded from the cache so that opening this tab a second time shows the
  // feed that was there when it closed, rather than a skeleton over the same
  // rows. Whatever is seeded is then revalidated by the load below.
  const [friends, setFriends] = useState<Person[]>(
    () => peek<Person[]>(cacheKey.friends) ?? []
  );
  const [incoming, setIncoming] = useState<Person[]>([]);
  const [loading, setLoading] = useState(
    () => peek(cacheKey.friends) === undefined
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(
    () => peek<Suggestion[]>(cacheKey.suggestions) ?? []
  );
  const [activity, setActivity] = useState<ActivityItem[]>(
    () => peek<ActivityItem[]>(cacheKey.activity) ?? []
  );

  const load = useCallback(async () => {
    try {
      const [people, requests, feed] = await Promise.all([
        cached(cacheKey.friends, api.listFriends, ttl.friends),
        // Not cached: a request waiting on you is the one thing on this screen
        // that must never be a minute old, and it is the cheapest of the four.
        api.listFriendRequests(),
        cached(cacheKey.activity, api.socialActivity, ttl.activity),
      ]);
      setFriends(people);
      setIncoming(requests.incoming);
      setActivity(feed);
      // Only worth asking once there is a friend to have friends of. Somebody
      // with an empty list would get an empty answer, and this screen is
      // already three requests deep.
      if (people.length > 0) {
        setSuggestions(
          await cached(
            cacheKey.suggestions,
            api.friendSuggestions,
            ttl.suggestions
          ).catch(() => [])
        );
      }
    } catch (err) {
      errorToast(err, "Could not load your friends");
    } finally {
      setLoading(false);
    }
  }, [errorToast]);

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
      // Through the cache rather than around it, so the entry this screen
      // will be seeded from next time is the one just fetched.
      revalidate(cacheKey.activity, api.socialActivity)
        .then(setActivity)
        .catch(() => undefined);
    }, ACTIVITY_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      stop();
    };
  }, []);

  /**
   * Look for somebody as the name is typed.
   *
   * Every result arrives knowing where you stand with the person it names, so
   * the row draws its own button without this screen cross-referencing the
   * friends list and the pending list. A search that fails is silent: the last
   * results stay put rather than the screen throwing a message at somebody who
   * is still typing.
   */
  useEffect(() => {
    const term = query.trim().replace(/^@+/, "");
    if (term.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      api
        .searchPeople(term)
        .then((rows) => {
          if (!live) return;
          setResults(rows);
          setSearched(true);
        })
        .catch(() => undefined);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const accept = async (person: Person): Promise<boolean> => {
    setIncoming((rows) =>
      rows.filter((r) => r.telegram_user_id !== person.telegram_user_id)
    );
    setFriends((rows) => [person, ...rows]);
    try {
      await api.acceptFriend(person.telegram_user_id);
      dropCache(
        cacheKey.friends,
        cacheKey.suggestions,
        cacheKey.activity,
        cacheKey.profile(person.telegram_user_id)
      );
      haptic.success();
      return true;
    } catch (err) {
      errorToast(err, "Could not accept that");
      void load();
      return false;
    }
  };

  /** Accepting from a search result has to move that row too. */
  const acceptFromSearch = async (person: PersonResult) => {
    if (!(await accept(person))) return;
    setResults((rows) =>
      rows.map((row) =>
        row.telegram_user_id === person.telegram_user_id
          ? { ...row, state: "friends" }
          : row
      )
    );
  };

  const invite = async () => {
    try {
      const link = await api.friendInviteLink();
      if (!shareLink(link, "Add me on Navaar")) toast(link);
    } catch (err) {
      errorToast(err, "Could not make an invite link");
    }
  };

  const openProfile = (id: string) =>
    nav.push({ type: "profile", userId: Number(id) });

  if (loading) {
    return (
      <Screen>
        <Skeleton rows={4} />
      </Screen>
    );
  }

  const listening = activity.filter((row) => row.kind === "listening");
  const feed = activity.filter((row) => row.kind !== "listening");
  const searching = query.trim().replace(/^@+/, "").length >= 2;

  return (
    <Screen>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <TextField
          value={query}
          onChange={setQuery}
          placeholder="Find someone by their @name"
          height={38}
          autoCorrect={false}
        />
      </div>

      {searching ? (
        <>
          <SectionHeader title="People" spaceAbove={16} />
          {results.length === 0 ? (
            searched ? (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-nav-muted)",
                  margin: "6px 2px",
                }}
              >
                Nobody by that name.
              </p>
            ) : (
              <Skeleton rows={2} />
            )
          ) : (
            results.map((person, i) => (
              <PersonRow
                key={person.telegram_user_id}
                person={person}
                index={i}
                onOpen={() => openProfile(person.telegram_user_id)}
                action={
                  person.state === "none" ? (
                    <AddFriendButton userId={person.telegram_user_id} />
                  ) : person.state === "pending_out" ? (
                    <ActionButton grow={false} disabled onClick={() => undefined}>
                      Requested
                    </ActionButton>
                  ) : person.state === "pending_in" ? (
                    <ActionButton
                      grow={false}
                      onClick={() => void acceptFromSearch(person)}
                    >
                      Accept
                    </ActionButton>
                  ) : undefined
                }
              />
            ))
          )}
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
              onOpen={() => openProfile(person.telegram_user_id)}
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
              <PersonTile
                key={row.person.telegram_user_id}
                person={row.person}
                line={row.track ? trackTitle(row.track) : undefined}
                index={i}
                onOpen={() => openProfile(row.person.telegram_user_id)}
              />
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
                  nav.push({ type: "playlist", id: item.playlist.id, name: item.playlist.name });
                  return;
                }
                openProfile(item.person.telegram_user_id);
              }}
            />
          ))}
        </>
      ) : null}

      {suggestions.length > 0 ? (
        <>
          <SectionHeader title="People you may know" spaceAbove={22} />
          {suggestions.map((person, i) => (
            <PersonRow
              key={person.telegram_user_id}
              person={person}
              index={i}
              note={
                person.mutual_friends.length > 0 ? (
                  <>Friends with {namesList(person.mutual_friends, person.mutual_count)}</>
                ) : (
                  <>
                    <Counted
                      count={person.mutual_count}
                      one="friend"
                      many="friends"
                    />{" "}
                    in common
                  </>
                )
              }
              onOpen={() => openProfile(person.telegram_user_id)}
              action={<AddFriendButton userId={person.telegram_user_id} />}
            />
          ))}
        </>
      ) : null}

      <SectionHeader
        title="Friends"
        action="Invite"
        onAction={() => void invite()}
        spaceAbove={
          incoming.length > 0 ||
          searching ||
          listening.length > 0 ||
          feed.length > 0 ||
          suggestions.length > 0
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
            onOpen={() => openProfile(person.telegram_user_id)}
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
        style={{ fontSize: 11, color: "var(--color-nav-faint)", flex: "none" }}
      >
        {formatAge(item.at)}
      </span>
    </button>
  );
}

/**
 * One person: 40px face, their name, and whatever the section needs on the end.
 *
 * The note under the name is for the one thing worth saying about somebody you
 * have not met — how many friends you have in common — and nothing else goes
 * there.
 */
function PersonRow({
  person,
  index,
  onOpen,
  action,
  note,
}: {
  person: Person;
  index: number;
  onOpen: () => void;
  action?: React.ReactNode;
  note?: React.ReactNode;
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
        <span style={{ minWidth: 0 }}>
          <span
            className="nav-clip"
            style={{ display: "block", fontSize: 13, fontWeight: 600 }}
          >
            {personName(person)}
          </span>
          {note ? (
            <span
              className="nav-clip"
              style={{
                display: "block",
                fontSize: 11,
                color: "var(--color-nav-muted)",
                marginTop: 2,
              }}
            >
              {note}
            </span>
          ) : null}
        </span>
      </button>
      {action ?? (
        <UserCheckIcon
          size={16}
          style={{ color: "var(--color-nav-faint)", flex: "none" }}
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
  const { errorToast } = useToast();
  const [state, setState] = useState<"idle" | "sent">("idle");

  if (state === "sent") {
    return (
      <ActionButton grow={false} disabled onClick={() => undefined}>
        Requested
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
            // Their page now says pending, and they may have been a suggestion.
            dropCache(cacheKey.profile(userId), cacheKey.suggestions);
            setState("sent");
            haptic.success();
            onDone?.();
          })
          .catch((err: unknown) =>
            errorToast(err, "Could not send that request")
          );
      }}
    >
      Add
    </ActionButton>
  );
}
