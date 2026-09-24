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
  /**
   * Summed across its live tracks, owner_name and follower_count alongside it.
   * Absent only right after creating a playlist, before its first refetch.
   */
  duration_seconds?: number;
  /** The owner's handle or username, for a header that names them. */
  owner_name?: string | null;
  /** How many people have saved this playlist to their own library. */
  follower_count?: number;
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
  /** One of the 8 accent presets, or "lime" for the app's own default. */
  accent_color: string;
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
  /** Who those friends are, so the row can name a couple of them. */
  mutual_friends: Person[];
}

/** A rollup of recent plays: what this person has been into lately. */
export interface ListeningStats {
  totalPlays: number;
  topTrack: ActivityTrack | null;
  /** `cover_track_id` is whichever of the artist's own tracks has art — not
   *  necessarily `topTrack` itself. Null when none of their tracks do. */
  topArtist: { name: string; cover_track_id: string | null } | null;
  totalListenedSeconds: number;
  /** `topTrack`/`topArtist` widened to a ranked top 3 for the stats panel. */
  topTracks: Array<ActivityTrack & { plays: number }>;
  topArtists: Array<{ name: string; cover_track_id: string | null; plays: number }>;
}

/** The six periods the Listening Stats page can be scoped to. */
export type StatsRange = "today" | "7d" | "30d" | "3m" | "1y" | "all";

/** The full first-person Listening Stats page — mirrors `ListeningStatsPage`
 *  in `server/src/repo.ts`. */
export interface ListeningStatsPage {
  range: StatsRange;
  /** Null only for "all". */
  periodStart: string | null;
  periodEnd: string;
  totalListenedSeconds: number;
  totalPlays: number;
  /** Same-length window immediately before this period; null for "all". */
  previous: { totalListenedSeconds: number; totalPlays: number } | null;
  topTracks: Array<ActivityTrack & { plays: number; seconds: number }>;
  topArtists: Array<{ name: string; cover_track_id: string | null; plays: number; seconds: number }>;
  /** Day buckets, or hour buckets when `range` is "today". */
  activity: Array<{ bucket: string; seconds: number; plays: number }>;
  /** 24 hourly buckets (local time when known), play counts. */
  timeOfDay: number[];
  /** 7 buckets, Monday first, play counts. */
  dayOfWeek: number[];
  /** 0..1, share of this period's distinct tracks that aren't a first-ever
   *  listen. */
  repeatRate: number;
  /** Distinct tracks played this period whose first-ever play falls in it. */
  discoveryCount: number;
  /** Distinct tracks played this period ÷ the listener's live owned tracks. */
  libraryCoveragePct: number;
  onRepeat: (ActivityTrack & { plays: number }) | null;
  /** Null when no session in the period clears the "meaningful" floor. */
  longestSessionMinutes: number | null;
  currentStreakDays: number;
}

/**
 * One person's page.
 *
 * `playlists` is already narrowed to what the viewer may open, so there is
 * nothing to filter here.
 */
export interface UserProfile {
  person: Person;
  state: FriendshipState;
  playlists: Playlist[];
  /** Null unless the viewer may see it: themselves, or a friend. */
  friend_count: number | null;
  /** Null under the same rule as friend_count. */
  stats: ListeningStats | null;
  /** Populated only for a not-yet-connected suggested profile. */
  mutual_friends: Person[];
  /** Null unless the profile's owner has pinned a track's cover as their
   *  header's background — otherwise it falls back to a wash of `stats.topTrack`. */
  background_track_id: string | null;
  /** Up to 3 Navaar Tags this person has pinned, in the order they chose. */
  equipped_tags: EquippedTag[];
}

/**
 * Navaar Tags: the app's one collectible music-identity layer.
 */
export type TagTier = "copper" | "chrome" | "gold" | "emerald" | "cosmic";
export type TagCategory = "listening" | "library" | "playlists" | "social" | "secret";

/**
 * One tag as GET /api/tags returns it, unlocked or not. `progress`/`target`
 * are null for any still-locked secret tag, and for the couple of public
 * tags with no single number worth showing a bar for — never assume they are
 * present just because the tag is public.
 */
export interface TagState {
  id: string;
  name: string;
  category: TagCategory;
  tier: TagTier;
  secret: boolean;
  unlocked: boolean;
  unlocked_at: string | null;
  equipped: boolean;
  /** flavor text once unlocked, the locked clue line while it isn't. */
  flavor: string;
  progress: number | null;
  target: number | null;
}

/** A tag as it appears pinned to someone else's profile — always unlocked,
 *  never carrying progress, since only an earned tag can be equipped. */
export interface EquippedTag {
  id: string;
  name: string;
  category: TagCategory;
  tier: TagTier;
  secret: boolean;
  flavor: string;
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

// --- Jam --------------------------------------------------------------------

/**
 * A track as a jam shows it. Everyone in a jam sees the same title and artist,
 * but only someone who could open the track alone gets `track` to play — joining
 * never widens what a person may stream.
 */
export interface JamTrack {
  id: string;
  title: string | null;
  artist: string | null;
  duration_seconds: number | null;
  /** Null when the viewer may not see this cover either. */
  cover_track_id: string | null;
  available: boolean;
  track: Track | null;
}

export interface JamQueueItem {
  id: string;
  track: JamTrack;
  added_by: Person;
}

export interface JamParticipant {
  person: Person;
  role: "host" | "guest";
}

export interface JamPlayback {
  track: JamTrack | null;
  item_id: string | null;
  position_seconds: number;
  /** Server time `position_seconds` was true at. */
  position_at: string;
  is_playing: boolean;
}

export interface JamView {
  id: string;
  /** What the viewer is in it. */
  role: "host" | "guest";
  host: Person;
  participants: JamParticipant[];
  playback: JamPlayback;
  queue: JamQueueItem[];
}

export type JamRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export interface JamRequest {
  id: string;
  status: JamRequestStatus;
  host: Person;
  requester: Person;
  created_at: string;
  expires_at: string;
}

/** `GET /api/jam` — and the answer to every jam write. */
export interface JamPoll {
  server_now: string;
  jam: JamView | null;
  /** Requests waiting on the viewer, as a host. */
  incoming: JamRequest[];
  /** The viewer's own latest request, while open or just answered. */
  outgoing: JamRequest | null;
}

/** `GET /api/users/:id/live` — what a friend is playing right now, if anything. */
export interface LiveState {
  server_now: string;
  live: {
    track: JamTrack;
    position_seconds: number;
    position_at: string;
    is_playing: boolean;
  } | null;
  jam: {
    id: string;
    role: "host" | "guest";
    listener_count: number;
    viewer_is_member: boolean;
    host: Person | null;
  } | null;
}
