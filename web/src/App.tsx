import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authenticate } from "./api";
import { BottomNav } from "./components/BottomNav";
import { ChooseName } from "./components/ChooseName";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { TopBar } from "./components/TopBar";
import { Empty } from "./components/ui";
import { LibraryProvider, useLibrary } from "./context/LibraryContext";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { ToastProvider } from "./context/ToastContext";
import { HomeView } from "./views/HomeView";
import { LibraryView } from "./views/LibraryView";
import { CrateView } from "./views/CrateView";
import { PlaylistView } from "./views/PlaylistView";
import { CollectionView } from "./views/CollectionView";
import { SocialView } from "./views/SocialView";
import { ProfileView } from "./views/ProfileView";
import { FriendLibraryView } from "./views/FriendLibraryView";
import { PlayerView } from "./views/PlayerView";
import { SharedView } from "./views/SharedView";
import { getTelegramWebApp, initTelegramPlatform, setBackButton } from "./telegram";
import type { Me } from "./types";
import type { RootTab, View } from "./view";
import { rootTabFor } from "./view";

/**
 * The shell.
 *
 * Navigation is a stack of View values, not a router. Telegram's own back
 * button pops it — the app draws no back chevron of its own anywhere except
 * the player, which is a sheet rather than a screen. Switching tabs resets the
 * stack to that tab's root: a Mini App session is short, and coming back to
 * Library four levels deep is more surprising than useful.
 *
 * The player is an overlay rather than a stack entry, because it must be able
 * to cover the nav and the bar it grew out of.
 */

export interface Navigation {
  push: (view: View) => void;
  pop: () => void;
  openPlayer: () => void;
}

const TITLES: Record<View["type"], string> = {
  home: "Navaar",
  library: "Library",
  crate: "The Crate",
  playlist: "Playlist",
  artist: "Artist",
  album: "Album",
  social: "Social",
  profile: "Profile",
  friendLibrary: "Library",
};

function Shell({ me }: { me: Me }) {
  const [stack, setStack] = useState<View[]>([{ type: "home" }]);
  const [direction, setDirection] = useState<"push" | "pop">("push");
  const [playerOpen, setPlayerOpen] = useState(false);
  const [searchOnOpen, setSearchOnOpen] = useState(false);
  // Bumped on every navigation so the incoming screen remounts and replays its
  // entrance; without it React reuses the subtree and nothing animates.
  const seq = useRef(0);

  const { tracks, loading, error, reload } = useLibrary();
  const { current, restoreLast } = usePlayer();

  const view = stack[stack.length - 1];

  const push = useCallback((next: View) => {
    seq.current += 1;
    setDirection("push");
    setStack((s) => [...s, next]);
  }, []);

  const pop = useCallback(() => {
    seq.current += 1;
    setDirection("pop");
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const selectTab = useCallback((tab: RootTab) => {
    seq.current += 1;
    setDirection("push");
    setStack([{ type: tab } as View]);
  }, []);

  const nav = useMemo<Navigation>(
    () => ({ push, pop, openPlayer: () => setPlayerOpen(true) }),
    [push, pop]
  );

  // Telegram's back button is the only back affordance. It pops the player
  // first, because the player sits over whatever screen opened it.
  useEffect(() => {
    const canGoBack = playerOpen || stack.length > 1;
    if (!canGoBack) return setBackButton(null);
    return setBackButton(() => {
      if (playerOpen) setPlayerOpen(false);
      else pop();
    });
  }, [playerOpen, stack.length, pop]);

  // The search button hands the Crate a flag rather than a mode of its own;
  // it is spent as soon as the Crate is left, so arriving there from Library
  // later does not silently open a keyboard.
  useEffect(() => {
    if (view.type !== "crate" && searchOnOpen) setSearchOnOpen(false);
  }, [view.type, searchOnOpen]);

  // Restoring where you were is a one-shot: only the first library load, and
  // only when nothing has started playing in the meantime.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || loading || tracks.length === 0 || current) return;
    restored.current = true;
    restoreLast(tracks);
  }, [loading, tracks, current, restoreLast]);

  const body = () => {
    if (error) {
      return (
        <Empty
          title="Nothing loaded"
          body={error}
          action="Try again"
          onAction={() => void reload()}
        />
      );
    }
    switch (view.type) {
      case "home":
        return <HomeView nav={nav} />;
      case "library":
        return <LibraryView nav={nav} />;
      case "crate":
        return <CrateView nav={nav} filter={view.filter} autoSearch={searchOnOpen} />;
      case "playlist":
        return <PlaylistView nav={nav} id={view.id} />;
      case "artist":
      case "album":
        return <CollectionView nav={nav} kind={view.type} name={view.name} />;
      case "social":
        return <SocialView nav={nav} />;
      case "profile":
        return <ProfileView nav={nav} userId={view.userId} />;
      case "friendLibrary":
        return <FriendLibraryView nav={nav} friendId={view.friendId} />;
    }
  };

  // A screen that prints its own name in its header — a playlist, an album,
  // an artist — gets only the kind up here. The name was already six lines
  // below in a bigger face, and saying it twice makes the reader stop to check
  // whether the two are the same thing.
  const named =
    view.type === "playlist" || view.type === "artist" || view.type === "album";
  const title = TITLES[view.type];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
        zIndex: 1,
      }}
    >
      <TopBar
        title={title}
        subdued={named}
        me={me}
        onSearch={
          view.type === "crate"
            ? undefined
            : () => {
                setSearchOnOpen(true);
                push({ type: "crate", filter: "all" });
              }
        }
        onProfile={() => push({ type: "profile", userId: me.id })}
      />

      <div
        key={seq.current}
        className={direction === "push" ? "nav-view-push" : "nav-view-pop"}
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        {body()}
      </div>

      {/* The bottom furniture floats over the content the same way the top
          bar does, so a list runs behind it instead of stopping at it. Every
          scroll container already reserves exactly this much room at its
          bottom, so nothing is hidden — it is only ever passed under. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
          pointerEvents: "none",
        }}
      >
        <NowPlayingBar onOpen={() => setPlayerOpen(true)} />
        <BottomNav active={rootTabFor(view)} onSelect={selectTab} />
      </div>

      {playerOpen ? (
        <PlayerView nav={nav} onClose={() => setPlayerOpen(false)} />
      ) : null}
    </div>
  );
}

function Boot() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => initTelegramPlatform(), []);

  const signIn = useCallback(async () => {
    setError(null);
    const initData = getTelegramWebApp()?.initData;
    if (!initData) {
      setError("Open Navaar from Telegram to sign in.");
      return;
    }
    try {
      setMe(await authenticate(initData));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign you in");
    }
  }, []);

  useEffect(() => {
    void signIn();
  }, [signIn]);

  if (!me) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          zIndex: 1,
        }}
      >
        {error ? (
          <Empty
            title="Not signed in"
            body={error}
            action="Try again"
            onAction={() => void signIn()}
          />
        ) : null}
      </div>
    );
  }

  // Before anything else, a name. Everything social is keyed on being able to
  // name a person — a friend request, a credit line, a shared playlist — and an
  // account that has never chosen one cannot take part in any of it. The bot
  // creates rows for people who have only ever forwarded a file, so this is the
  // first screen of the app rather than a step in a sign-up the app never had.
  if (me.handle == null) {
    return (
      <ChooseName
        suggestion={me.username ?? ""}
        onChosen={(handle) => setMe({ ...me, handle })}
      />
    );
  }

  return (
    <LibraryProvider me={me} setMe={setMe}>
      <PlayerProvider>
        <Shell me={me} />
      </PlayerProvider>
    </LibraryProvider>
  );
}

/**
 * The share page is the one thing in Navaar that has an address.
 *
 * It is matched here rather than being a View, because a View is a screen of
 * the shell: it gets the top bar, the bottom nav, the player and a session, and
 * this has none of those. There is still no router — one path, matched once at
 * startup, is the whole of it, and a Mini App never navigates to it.
 */
const SHARE_PATH = /^\/s\/([A-Za-z0-9_-]{8,64})\/?$/;

export default function App() {
  const shared = SHARE_PATH.exec(window.location.pathname);
  if (shared) {
    return (
      <ToastProvider>
        <div className="nav-screen-bg" aria-hidden="true" />
        <SharedView slug={shared[1]} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      {/* The wash is its own layer rather than a class on the shell. It is
          pointer-events: none by design — worn as a container it is inherited
          by every descendant and the whole app stops responding to taps. */}
      <div className="nav-screen-bg" aria-hidden="true" />
      <Boot />
    </ToastProvider>
  );
}
