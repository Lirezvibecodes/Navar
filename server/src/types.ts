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
}
