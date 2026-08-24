/**
 * Where the app is. A tagged union rather than a router: a Mini App has no
 * address bar, no deep links to honour and no history to sync with, so a URL
 * layer would be machinery serving nobody. Navigation is a stack of these,
 * pushed and popped by the shell, with Telegram's own back button popping it.
 */
export type View =
  | { type: "home" }
  | { type: "library" }
  | { type: "crate"; filter: "all" | "unsorted" }
  | { type: "playlist"; id: string }
  | { type: "artist"; name: string }
  | { type: "album"; name: string }
  | { type: "social" }
  /** One view serves both your own profile and somebody else's; the edit
   *  affordances turn on when userId is you. */
  | { type: "profile"; userId: number }
  | { type: "friendLibrary"; friendId: number };

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
      return "social";
  }
}
