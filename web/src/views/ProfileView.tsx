import { useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { AddFriendButton } from "./SocialView";
import { Avatar } from "../components/Avatar";
import { NameSheet } from "../components/NameSheet";
import {
  ActionButton,
  Empty,
  GhostButton,
  Screen,
  SectionHeader,
  Skeleton,
} from "../components/ui";
import { LibraryIcon, ShareIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { personName, pluralise } from "../lib/format";
import { haptic, shareLink } from "../telegram";
import type { Person } from "../types";

/**
 * One person's page — yours or somebody else's.
 *
 * There is one screen rather than two because the difference between them is
 * only which affordances are live: your own page offers an invite link and
 * counts drawn from the library already in memory, and someone else's offers
 * the relationship. Profiles proper — badges, endorsements, public content for
 * strangers — need the discovery endpoints from the social phase; until those
 * exist this page states plainly what it knows.
 */
export function ProfileView({ nav, userId }: { nav: Navigation; userId: number }) {
  const { me, setMe, tracks, playlists } = useLibrary();
  const { toast } = useToast();

  const isMe = me?.id === userId;
  const [renaming, setRenaming] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [known, setKnown] = useState(!isMe);
  const [loading, setLoading] = useState(!isMe);

  useEffect(() => {
    if (isMe) return;
    let live = true;
    api
      .listFriends()
      .then((friends) => {
        if (!live) return;
        const match = friends.find((f) => Number(f.telegram_user_id) === userId);
        setPerson(match ?? null);
        setKnown(match != null);
      })
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [isMe, userId]);

  const invite = async () => {
    try {
      const link = await api.friendInviteLink();
      if (!shareLink(link, "Add me on Navaar")) toast(link);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not make an invite link");
    }
  };

  const unfriend = async () => {
    try {
      await api.removeFriend(userId);
      haptic.warning();
      nav.pop();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove them");
    }
  };

  if (loading) {
    return (
      <Screen>
        <Skeleton rows={3} />
      </Screen>
    );
  }

  const name = personName(isMe ? me : person);

  const rename = async (typed: string) => {
    if (!me) return;
    try {
      const { handle } = await api.setHandle(typed);
      setMe({ ...me, handle });
      haptic.success();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change your name");
    }
  };

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
        {/* Tapping your own name is the whole rename affordance. A name is
            the only thing on this page that is yours to edit, so a control
            saying so would be louder than the thing it controls. */}
        <button
          className={isMe ? "nav-press" : undefined}
          disabled={!isMe}
          onClick={() => {
            haptic.tap();
            setRenaming(true);
          }}
          style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em" }}
        >
          {name}
        </button>
        {isMe ? (
          <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.52)" }}>
            {pluralise(tracks.length, "track")} ·{" "}
            {pluralise(playlists.length, "playlist")}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {isMe ? (
          <ActionButton icon={ShareIcon} onClick={() => void invite()}>
            Invite a friend
          </ActionButton>
        ) : known ? (
          <>
            <ActionButton
              icon={LibraryIcon}
              onClick={() => nav.push({ type: "friendLibrary", friendId: userId })}
            >
              Their library
            </ActionButton>
            <GhostButton onClick={() => void unfriend()}>Remove</GhostButton>
          </>
        ) : (
          <AddFriendButton userId={userId} />
        )}
      </div>

      {isMe ? (
        <>
          <SectionHeader title="Your library" />
          <GhostButton
            icon={LibraryIcon}
            height={44}
            onClick={() => nav.push({ type: "crate", filter: "all" })}
          >
            Open The Crate
          </GhostButton>
        </>
      ) : !known ? (
        <Empty
          title="Not connected yet"
          body="Send a request. Once they accept, anything they share with friends shows up for you."
        />
      ) : null}

      <NameSheet
        open={renaming}
        title="Your name"
        initial={me?.handle ?? ""}
        placeholder="yourname"
        maxLength={20}
        confirmLabel="Save"
        onSubmit={(value) => void rename(value)}
        onClose={() => setRenaming(false)}
      />
    </Screen>
  );
}
