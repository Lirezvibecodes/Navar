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
  /** Who first brought this track into Navaar; see repo.NewTrack. */
  origin_adder_id: string | null;
  /** When the owner hearted this track, or null. Only ever the owner's own. */
  favorited_at: string | null;
  /** Whether a Lyrics pane has anything to show; the text itself is fetched
   * per track by GET /api/tracks/:id/lyrics. */
  has_lyrics: boolean;
  created_at: string;
  /**
   * Who the caller got this track from, resolved by the library listing only.
   * Absent on the single-track responses, and blank whenever the caller has no
   * relationship with that person — a credit line must never introduce a
   * stranger by name.
   */
  credit_user_id?: string | null;
  credit_username?: string | null;
  /**
   * Whether the track sits in any playlist. Carried on the library listing so
   * the Crate's All/Unsorted chips are a filter over rows already in hand
   * rather than a second request.
   */
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
  /**
   * The credential for the unauthenticated share link. Present only while
   * visibility allows a link; rotating it is the only way to revoke one.
   */
  share_slug: string | null;
  /** Set when this playlist is the shared crate of a Telegram group chat. */
  group_chat_id: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Filled in by the listing query so the playlist grid can draw a tile and a
   * count without a request per tile. Absent from single-playlist responses.
   */
  track_count?: number;
  cover_track_id?: string | null;
  /**
   * True when the owner has given the playlist a picture of its own, which
   * outranks cover_track_id. The image is fetched from the playlist's cover
   * endpoint rather than a track's.
   */
  has_cover?: boolean;
}

/**
 * A track as it appears to somebody holding a share link and nothing else.
 *
 * Its own type rather than a Partial<Track>: the shared page is served to
 * people with no account, so what it may carry is a decision, and a decision
 * that lives in a type is one a future field cannot quietly join. There is no
 * owner here, no origin, no telegram_file_id and no credit — a stranger should
 * not get a map of who passed what to whom.
 */
export interface SharedTrack {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_seconds: number | null;
  has_cover: boolean;
}

/** The playlist behind a live share link, on the same terms. */
export interface SharedPlaylist {
  id: string;
  name: string;
  description: string | null;
  share_slug: string;
  has_cover: boolean;
  /**
   * The name the owner chose, or their Telegram username. The one person a
   * share link does name, because publishing it is what attaches their name to
   * it — everyone else in the playlist's history stays anonymous.
   */
  owner_name: string | null;
  track_count: number;
  cover_track_id: string | null;
}

/**
 * What GET /api/shared/:slug answers with: the row, plus the way back in.
 *
 * The link is composed by the route rather than read from the database, which
 * is why it is a type of its own instead of another column on SharedPlaylist —
 * it depends on the bot's own @username, resolved at startup, and is null in
 * API-only mode where there is no bot to open.
 */
export interface SharedPlaylistPage extends SharedPlaylist {
  app_link: string | null;
}
