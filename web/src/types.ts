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
  created_at: string;
}

export interface Playlist {
  id: string;
  owner_telegram_id: string;
  name: string;
  created_at: string;
}
