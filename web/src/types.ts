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
  /** Who first brought this track into Navaar. No UI yet — see the roadmap. */
  origin_adder_id: string | null;
  /** When the owner hearted it. Only meaningful on tracks you own. */
  favorited_at: string | null;
  /** Whether the Lyrics pane has anything to fetch. */
  has_lyrics: boolean;
  created_at: string;
  /** Who you got this track from; blank unless you know them. Library only. */
  credit_user_id?: string | null;
  credit_username?: string | null;
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
  has_avatar: boolean;
}

export interface Me {
  id: number;
  username: string | null;
  first_name: string | null;
}
