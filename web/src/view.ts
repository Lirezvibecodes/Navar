export type View =
  | { type: "library" }
  | { type: "playlists" }
  | { type: "playlist"; id: string };
