/**
 * Where the app is. A tagged union rather than a router: a Mini App has no
 * address bar, no deep links to honour and no history to sync with, so a URL
 * layer would be machinery serving nobody. Navigation is a stack of these,
 * pushed and popped by the shell, with Telegram's own back button popping it.
 */
/**
 * The two cuts of the Crate. Favourites used to be a third — a filter over
 * the same rows — but it now behaves enough like a playlist (its own screen,
 * its own tile in Library's Playlists grid) that it left the Crate for a
 * `View` of its own below.
 */
export type CrateFilter = "all" | "unsorted";

export type View =
  | { type: "home" }
  /**
   * The Crate lives inside this screen now, as one of its own tabs, rather
   * than as a destination you navigate to — so reaching it with intent from
   * outside (a "23 unsorted" nudge on Home) has to travel as part of this
   * same push instead of a separate view. `openCrate` selects the tab and its
   * cut on arrival; it means nothing once the screen has mounted — flipping
   * tabs after that is just the screen's own state.
   */
  | { type: "library"; openCrate?: CrateFilter }
  /**
   * Reached from the search icon beside the profile picture, on every screen
   * that has one. Its results are categorised across the whole library —
   * tracks, playlists, albums, artists — rather than scoped to whichever
   * screen the icon happened to be tapped from.
   */
  | { type: "search" }
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
  /**
   * Every track you have hearted, shown the way a playlist is. It has no row
   * of its own — membership is `favorited_at` on a track you own — which is
   * exactly what keeps it from being shared, renamed or added to by hand: the
   * heart on a row is the only door in or out.
   */
  | { type: "favorites" }
  | { type: "social" }
  /** One view serves both your own profile and somebody else's; the edit
   *  affordances turn on when userId is you. */
  | { type: "profile"; userId: number }
  | { type: "friendLibrary"; friendId: number }
  /** Reached only from your own profile: name, photo, accent, privacy. */
  | { type: "settings" }
  /** Reached only by pushing from Profile — not a 4th bottom-nav tab. */
  | { type: "tags" }
  /** Reached only from your own profile's listen chip — a friend's profile
   *  keeps the lifetime-stats sheet instead, since this page is first-person
   *  throughout and always scoped to whoever is signed in. */
  | { type: "stats" };

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
    case "search":
    case "playlist":
    case "artist":
    case "album":
    case "favorites":
      return "library";
    case "social":
    case "profile":
    case "friendLibrary":
    case "settings":
    case "tags":
    case "stats":
      return "social";
  }
}
