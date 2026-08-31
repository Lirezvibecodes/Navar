/**
 * Where the app is. A tagged union rather than a router: a Mini App has no
 * address bar, no deep links to honour and no history to sync with, so a URL
 * layer would be machinery serving nobody. Navigation is a stack of these,
 * pushed and popped by the shell, with Telegram's own back button popping it.
 */
/**
 * The three cuts of the Crate. `favorites` is the newest and the one that had
 * nowhere to go: every heart in the app writes `favorited_at`, and until there
 * was a filter for it, nothing ever read that back.
 */
export type CrateFilter = "all" | "unsorted" | "favorites";

export type View =
  | { type: "home" }
  | { type: "library" }
  | { type: "crate"; filter: CrateFilter }
  /**
   * `name` is not a convenience. Your own playlists are in the library, so the
   * header can look theirs up — but a friend's playlist, or one opened from an
   * activity feed, is not in your library and never will be. Without the name
   * travelling with the push, every one of those screens was titled
   * "Playlist". Whatever opened the link knew the name; it passes it on.
   */
  | { type: "playlist"; id: string; name?: string }
  | { type: "artist"; name: string }
  | { type: "album"; name: string }
  | { type: "social" }
  /** One view serves both your own profile and somebody else's; the edit
   *  affordances turn on when userId is you. */
  | { type: "profile"; userId: number }
  | { type: "friendLibrary"; friendId: number }
  /** Reached only from your own profile: name, photo, accent, privacy. */
  | { type: "settings" };

/** The three destinations the bottom nav and the sidebar offer. */
export type RootTab = "home" | "library" | "social";

/**
 * Which tab stays lit while a given view is open. Everything reachable from
 * Library keeps Library lit, so drilling into a playlist never looks like it
 * moved you to another section of the app.
 */
export function rootTabFor(view: View): RootTab {
  switch (view.type) {
    case "home":
      return "home";
    case "library":
    case "crate":
    case "playlist":
    case "artist":
    case "album":
      return "library";
    case "social":
    case "profile":
    case "friendLibrary":
    case "settings":
      return "social";
  }
}
