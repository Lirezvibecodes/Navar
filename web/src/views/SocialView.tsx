import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { Avatar } from "../components/Avatar";
import { ActionButton, Empty, Screen, SectionHeader, Skeleton } from "../components/ui";
import { UserCheckIcon, UserPlusIcon } from "../icons";
import { useToast } from "../context/ToastContext";
import { haptic, shareLink } from "../telegram";
import type { Person } from "../types";

/**
 * People.
 *
 * Search, listening status, the activity feed and suggestions all need tables
 * that arrive with the social phase; until they do, this screen shows the two
 * things the server can already answer — who you are friends with, and who is
 * waiting on you — and nothing else. A section with no data behind it renders
 * nothing at all rather than an empty frame, so the screen grows as the
 * backend does instead of being a grid of placeholders.
 */
export function SocialView({ nav }: { nav: Navigation }) {
  const { toast } = useToast();
  const [friends, setFriends] = useState<Person[]>([]);
  const [incoming, setIncoming] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <Screen>
      {incoming.length > 0 ? (
        <>
          <SectionHeader title="Waiting on you" spaceAbove={6} />
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
        spaceAbove={incoming.length > 0 ? 22 : 6}
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

/** One person: 40px face, @username, and whatever the section needs on the end. */
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
          username={person.username}
          hasAvatar={person.has_avatar}
          size={40}
        />
        <span className="nav-clip" style={{ fontSize: 13, fontWeight: 600 }}>
          {person.username ? `@${person.username}` : "Telegram user"}
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
