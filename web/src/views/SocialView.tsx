import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Avatar } from "../components/Avatar";
import { ActionButton, Empty, Screen, SectionHeader, Skeleton } from "../components/ui";
import { UserCheckIcon, UserPlusIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { personName } from "../lib/format";
import { haptic, shareLink } from "../telegram";
import type { Person } from "../types";

/**
 * People.
 *
 * Listening status, the activity feed and suggestions all need tables that
 * arrive with the social phase; until they do, this screen shows what the
 * server can already answer — who you are friends with, who is waiting on you,
 * and the person behind a name you were given. A section with no data behind it
 * renders nothing at all rather than an empty frame, so the screen grows as the
 * backend does instead of being a grid of placeholders.
 */
export function SocialView({ nav }: { nav: Navigation }) {
  const { toast } = useToast();
  const { me } = useLibrary();
  const [friends, setFriends] = useState<Person[]>([]);
  const [incoming, setIncoming] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person | null>(null);

  const load = useCallback(async () => {
    try {
      const [people, requests] = await Promise.all([
        api.listFriends(),
        api.listFriendRequests(),
      ]);
      setFriends(people);
      setIncoming(requests.incoming);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load your friends");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

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

      <SectionHeader
        title="Friends"
        action="Invite"
        onAction={() => void invite()}
        spaceAbove={incoming.length > 0 || found ? 22 : 16}
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
