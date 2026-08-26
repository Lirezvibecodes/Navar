/**
 * The wire shapes, mirroring server/src/types.ts. Snake case throughout,
 * because these are rows and renaming them on the way in only creates two
 * vocabularies for the same field.
 */

export interface Track {
  id: string;
  owner_telegram_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_seconds: number | null;
  telegram_file_id: string;
  mime_type: string | null;
  has_cover: boolean;
  /** Who first brought this track into Navaar. The id only; see uploader_* for the name. */
  origin_adder_id: string | null;
  /** When the owner hearted it. Only meaningful on tracks you own. */
  favorited_at: string | null;
  /** Whether the Lyrics pane has anything to fetch. */
  has_lyrics: boolean;
  created_at: string;
  /** Who you got this track from; blank unless you know them. Library only. */
  credit_user_id?: string | null;
  credit_username?: string | null;
  /**
   * Who put the track into Navaar in the first place — you, for anything you
   * forwarded yourself. Blank when naming them would introduce a stranger, so
   * treat the absence as "nobody to name" rather than "nobody added it".
   */
  uploader_id?: string | null;
  uploader_username?: string | null;
  /** Whether it sits in any playlist — the All/Unsorted split, precomputed. */
  in_playlist?: boolean;
}

export type PlaylistVisibility = "private" | "friends" | "public";

export interface Playlist {
  id: string;
  owner_telegram_id: string;
  name: string;
  /** What the owner has written about it, or null if they never have. */
  description: string | null;
  visibility: PlaylistVisibility;
  share_slug: string | null;
  group_chat_id: string | null;
  created_at: string;
  updated_at: string;
  track_count?: number;
  cover_track_id?: string | null;
  /** Whether the owner gave it a picture of its own, which wins over the pinned track. */
  has_cover?: boolean;
}

/** An album or an artist: a GROUP BY over tags, not a table. */
export interface Collection {
  name: string;
  track_count: number;
  cover_track_id: string | null;
  /** Albums only. */
  artist: string | null;
}

export interface Person {
  telegram_user_id: string;
  username: string | null;
  /** The name they chose in Navaar. Null only for an account that has never opened it. */
  handle: string | null;
  has_avatar: boolean;
}

export interface Me {
  id: number;
  username: string | null;
  first_name: string | null;
  /** Null until this person has chosen one, which the app asks for on first launch. */
  handle: string | null;
  /** Whether friends are shown what you are playing. Off until you say so. */
  listening_public: boolean;
}

/**
 * A track as the share page sees it.
 *
 * Its own type rather than a slice of Track, mirroring the server's: the
 * shared page is served to people with no account, and what it is allowed to
 * carry is a decision rather than an accident. There is no owner here and no
 * credit — a stranger does not get a map of who passed what to whom.
 */
export interface SharedTrack {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_seconds: number | null;
  has_cover: boolean;
}

/** The playlist behind a live share link. */
export interface SharedPlaylist {
  id: string;
  name: string;
  description: string | null;
  share_slug: string;
  has_cover: boolean;
  /** The one person a share link names: whoever published it. */
  owner_name: string | null;
  track_count: number;
  cover_track_id: string | null;
}

/**
 * What GET /api/shared/:slug answers with: the row, plus the way back in.
 *
 * The link is composed by the server rather than stored, and is null when it
 * is running without a bot — the share page then simply has no call to action
 * rather than one that opens nothing.
 */
export interface SharedPlaylistPage extends SharedPlaylist {
  app_link: string | null;
}

/**
 * A track as a social row carries it: enough to name, not enough to play.
 *
 * `cover_track_id` is the id to fetch artwork from, and is null whenever the
 * viewer may not fetch it — a friend can be playing something out of a
 * playlist you have never been shown. Null draws the generated tile, which is
 * what the app already does for a track that simply has no picture.
 */
export interface ActivityTrack {
  id: string;
  title: string | null;
  artist: string | null;
  cover_track_id: string | null;
}

/** A playlist as a social row carries it. No share_slug — that is a credential. */
export interface ActivityPlaylist {
  id: string;
  name: string;
  has_cover: boolean;
  cover_track_id: string | null;
  updated_at: string;
}

/** Somebody playing something right now, as one of their friends sees it. */
export interface ListeningNow {
  person: Person;
  track: ActivityTrack;
  at: string;
}

export type ActivityKind = "listening" | "shared" | "saved";

/**
 * One row of the Social feed.
 *
 * `from` is the second name a save carries, and is null unless the server
 * decided the viewer may see that person — a row never introduces a stranger,
 * and the client does not get to make that call. Render what is here.
 */
export interface ActivityItem {
  kind: ActivityKind;
  at: string;
  person: Person;
  from: Person | null;
  track: ActivityTrack | null;
  playlist: ActivityPlaylist | null;
}

/** Where you stand with somebody. Sent with every search result. */
export type FriendshipState =
  | "self"
  | "friends"
  | "pending_out"
  | "pending_in"
  | "none";

/**
 * A search result: a person, and the one thing that decides what the row's
 * button should say. It comes down with the row so the list does not have to
 * cross-reference a friends list and a pending list to draw itself.
 */
export interface PersonResult extends Person {
  state: FriendshipState;
}

/** Somebody two hops away, and how many friends you have in common. */
export interface Suggestion extends Person {
  mutual_count: number;
}

/**
 * A tier earned through endorsements.
 *
 * There is no count here and there is not meant to be one. Every tier renders
 * at the same weight, and `id` is what the client tests against — the first
 * tier is what everybody starts on and is shown nowhere but your own profile.
 */
export interface BadgeTier {
  id: string;
  label: string;
  min: number;
}

/**
 * One person's page.
 *
 * `playlists` is already narrowed to what the viewer may open, so there is
 * nothing to filter here. `can_endorse` is the server saying the endorsement
 * has been earned; the button is absent otherwise rather than present and
 * refused.
 */
export interface UserProfile {
  person: Person;
  state: FriendshipState;
  tier: BadgeTier;
  endorsed: boolean;
  can_endorse: boolean;
  playlists: Playlist[];
}

/** Somebody else's playlist as Home carries it: whose it is, and no share slug. */
export interface FriendPlaylist extends ActivityPlaylist {
  person: Person;
  track_count: number;
}

/**
 * The whole first screen, in one response.
 *
 * Every key is optional, and an absent key means that section is not on the
 * screen at all — not empty, not a header with nothing under it. The server
 * decides which sections exist; Home renders what it was given.
 */
export interface HomePayload {
  continue_listening?: Track[];
  playlists?: Playlist[];
  friend_activity?: ListeningNow[];
  from_friends?: FriendPlaylist[];
  /** Present only once enough unfiled tracks have piled up to be worth saying. */
  unsorted?: number;
}
