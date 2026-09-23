import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Avatar } from "../components/Avatar";
import { CollectionArt } from "../components/PixelArt";
import { PersonTile } from "../components/PersonTile";
import {
  ActionButton,
  Counted,
  Empty,
  GhostButton,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  TextField,
} from "../components/ui";
import {
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  HeadphonesIcon,
  ShareIcon,
  UserCheckIcon,
  UserPlusIcon,
} from "../icons";
import type { IconProps } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import {
  cached,
  cacheKey,
  dropCache,
  peek,
  revalidate,
  ttl,
} from "../lib/cache";
import {
  formatAge,
  listeningAge,
  namesList,
  personName,
  trackTitle,
} from "../lib/format";
import { haptic, onActivationChange, shareLink } from "../telegram";
import type { ActivityItem, Person, PersonResult, Suggestion } from "../types";

/**
 * People.
 *
 * A live room (who is playing something right now, or was recently), an
 * activity journal (what the people you know have been doing), who is
 * waiting on you, and a directory to find more of them. A section with no
 * data behind it renders nothing at all rather than an empty frame — most of
 * this screen is blank on the first day and that is correct.
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

/** How many suggestions show inline before "See all" is worth offering. */
const SUGGESTION_PREVIEW = 3;

/** Whether a person in a feed row is the viewer themself. */
function isMe(
  meId: string | number | null | undefined,
  personId: string | number
): boolean {
  return meId != null && String(personId) === String(meId);
}

export function SocialView({
  nav,
  searchOpen,
  onCloseSearch,
}: {
  nav: Navigation;
  /** Owned by the shell — its search icon sits beside the avatar, see App.tsx. */
  searchOpen: boolean;
  onCloseSearch: () => void;
}) {
  const { toast, errorToast } = useToast();
  const { me } = useLibrary();
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
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

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => {
    setQuery("");
    onCloseSearch();
  };

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
        cacheKey.profile(person.telegram_user_id),
        // Accepting is the one friendship action that lands on this session's
        // own social tags (First Contact, Social Butterfly, Connector).
        cacheKey.tags
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
    <Screen scrollKey="social">
      {searchOpen ? (
        <div
          className="nav-rise"
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}
        >
          <TextField
            ref={searchRef}
            value={query}
            onChange={setQuery}
            placeholder="Find someone by their @name"
            height={38}
            autoCorrect={false}
          />
          <GhostButton
            icon={CloseIcon}
            label="Close search"
            width={44}
            onClick={closeSearch}
          />
        </div>
      ) : null}

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

      {listening.length > 0 ? (
        <>
          <SectionHeader title="Live now" eyebrow spaceAbove={16} />
          <div className="nav-shelf" style={{ gap: 12 }}>
            {listening.map((row, i) => {
              const age = listeningAge(row.at);
              return (
                <PersonTile
                  key={row.person.telegram_user_id}
                  person={row.person}
                  name={isMe(me?.id, row.person.telegram_user_id) ? "You" : undefined}
                  line={
                    age.live
                      ? row.track
                        ? trackTitle(row.track)
                        : undefined
                      : age.label
                  }
                  live={age.live}
                  dim={!age.live}
                  index={i}
                  onOpen={() => openProfile(row.person.telegram_user_id)}
                />
              );
            })}
          </div>
        </>
      ) : null}

      {incoming.length > 0 ? (
        <FriendRequestsRow
          count={incoming.length}
          spaceAbove={listening.length > 0 ? 22 : 16}
          onOpen={() => setRequestsOpen(true)}
        />
      ) : null}

      {feed.length > 0 ? (
        <>
          <SectionHeader title="Around your people" eyebrow spaceAbove={22} />
          {feed.map((item, i) => (
            <ActivityRow
              key={item.kind + item.person.telegram_user_id + item.at}
              item={item}
              meId={me?.id}
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

      <SectionHeader
        title="Your people"
        eyebrow
        action={friends.length > 0 ? "View all" : undefined}
        onAction={() => setFriendsOpen(true)}
        spaceAbove={22}
      />
      {friends.length === 0 ? (
        <Empty
          title="Nobody here yet"
          body="Send someone your invite link. Once they add you, what each of you shares shows up on the other's Home."
          action="Invite a friend"
          onAction={() => void invite()}
        />
      ) : (
        <div className="nav-shelf" style={{ gap: 8 }}>
          {friends.map((person, i) => (
            <PersonTile
              key={person.telegram_user_id}
              person={person}
              index={i}
              onOpen={() => openProfile(person.telegram_user_id)}
            />
          ))}
        </div>
      )}

      <SectionHeader
        title="Find your people"
        eyebrow
        action="Invite"
        onAction={() => void invite()}
        spaceAbove={22}
      />
      {suggestions.length > 0 ? (
        <>
          {suggestions.slice(0, SUGGESTION_PREVIEW).map((person, i) => (
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
          {suggestions.length > SUGGESTION_PREVIEW ? (
            <button
              className="nav-press"
              onClick={() => {
                haptic.tap();
                setSuggestOpen(true);
              }}
              style={{
                color: "var(--color-nav-action)",
                fontSize: 11.5,
                fontWeight: 600,
                minHeight: 40,
                padding: "4px 2px",
              }}
            >
              See all
            </button>
          ) : null}
        </>
      ) : null}

      <Sheet
        open={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        title="Friend requests"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 12px 10px" }}>
          {incoming.map((person, i) => (
            <PersonRow
              key={person.telegram_user_id}
              person={person}
              index={i}
              onOpen={() => {
                setRequestsOpen(false);
                openProfile(person.telegram_user_id);
              }}
              action={
                <ActionButton grow={false} onClick={() => void accept(person)}>
                  Accept
                </ActionButton>
              }
            />
          ))}
        </div>
      </Sheet>

      <Sheet
        open={friendsOpen}
        onClose={() => setFriendsOpen(false)}
        title="Your people"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 12px 10px" }}>
          {friends.map((person, i) => (
            <PersonRow
              key={person.telegram_user_id}
              person={person}
              index={i}
              onOpen={() => {
                setFriendsOpen(false);
                openProfile(person.telegram_user_id);
              }}
            />
          ))}
        </div>
      </Sheet>

      <Sheet
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        title="Find your people"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 12px 10px" }}>
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
              onOpen={() => {
                setSuggestOpen(false);
                openProfile(person.telegram_user_id);
              }}
              action={<AddFriendButton userId={person.telegram_user_id} />}
            />
          ))}
        </div>
      </Sheet>
    </Screen>
  );
}

/**
 * The compact utility row for pending requests — a line, never a reserved
 * block. It only ever renders while `incoming.length > 0`, so there is no
 * empty state to design for: the row simply is not there otherwise.
 */
function FriendRequestsRow({
  count,
  spaceAbove,
  onOpen,
}: {
  count: number;
  spaceAbove: number;
  onOpen: () => void;
}) {
  return (
    <button
      className="nav-press nav-row-in"
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minHeight: 44,
        marginTop: spaceAbove,
        textAlign: "left",
      }}
    >
      <UserPlusIcon size={16} style={{ color: "var(--color-nav-action)", flex: "none" }} />
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>
        <Counted count={count} one="friend request" many="friend requests" />
      </span>
      <ChevronRightIcon size={14} style={{ color: "var(--color-nav-faint)", flex: "none" }} />
    </button>
  );
}

/**
 * What kind of thing happened, as a glyph on the art's corner rather than
 * only as a verb in the caption below it — the feed used to read as one
 * undifferentiated wall of text, and a save and a share are not the same
 * shape of event. `shared` gets the tab's own accent, unused everywhere else
 * in the app, so this is the one place that color was always meant for.
 */
const KIND_GLYPH: Record<
  ActivityItem["kind"],
  { icon: (props: IconProps) => React.ReactNode; background: string }
> = {
  listening: { icon: HeadphonesIcon, background: "var(--color-nav-action)" },
  shared: { icon: ShareIcon, background: "var(--color-nav-social)" },
  saved: { icon: DownloadIcon, background: "var(--color-nav-art)" },
};

/**
 * One thing that happened.
 *
 * A save carries two people — whoever kept the track and whoever they got it
 * from — and the second is here only if the server sent it. It leaves that
 * name out for anybody the viewer cannot already see, so there is no branch
 * here deciding whether a stranger may be introduced: the row simply says less.
 *
 * The feed carries the viewer's own shares and saves too, so either name on
 * the row can be theirs — "You" reads better there than their own handle
 * would, the same way a chat shows "You" for your own messages.
 */
function ActivityRow({
  item,
  meId,
  index,
  onOpen,
}: {
  item: ActivityItem;
  meId: string | number | null | undefined;
  index: number;
  onOpen: () => void;
}) {
  const title = item.playlist
    ? item.playlist.name
    : item.track
      ? trackTitle(item.track)
      : "Something";
  const verb = item.kind === "shared" ? "shared a playlist" : "saved a track";
  const who = isMe(meId, item.person.telegram_user_id) ? "You" : personName(item.person);
  const credit = item.from
    ? " · from " + (isMe(meId, item.from.telegram_user_id) ? "you" : personName(item.from))
    : "";
  const kind = KIND_GLYPH[item.kind];

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
      <div style={{ position: "relative", flex: "none" }}>
        <CollectionArt
          name={title}
          coverTrackId={item.playlist?.cover_track_id ?? item.track?.cover_track_id}
          src={item.playlist ? api.playlistArtworkUrl(item.playlist) : null}
          size={42}
          radius={9}
        />
        <span
          className="nav-uploader-badge"
          style={{
            position: "absolute",
            right: -4,
            bottom: -4,
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: kind.background,
          }}
        >
          <kind.icon size={10} style={{ color: "#0A0A0A" }} />
        </span>
      </div>
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
          {who} {verb}
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
 *
 * Exported so the profile screen's friends-list sheet can render the same row.
 */
export function PersonRow({
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
