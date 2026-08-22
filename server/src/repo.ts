import { getPool } from "./db";
import type { Track, Playlist } from "./types";

export async function ensureUser(
  telegramUserId: number,
  username: string | undefined
): Promise<void> {
  await getPool().query(
    `INSERT INTO users (telegram_user_id, username)
     VALUES ($1, $2)
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET username = EXCLUDED.username`,
    [telegramUserId, username ?? null]
  );
}

export interface NewTrack {
  id: string;
  ownerTelegramId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
  telegramFileId: string;
  mimeType: string | null;
  coverImage: Buffer | null;
  coverMimeType: string | null;
}

// Excludes cover_image so list/get/update calls never pull cover bytes over
// the wire; the dedicated cover route/query below fetches those on demand.
const TRACK_COLUMNS = `
  id, owner_telegram_id, title, artist, album, duration_seconds,
  telegram_file_id, mime_type, (cover_image IS NOT NULL) AS has_cover, created_at
`;

export async function createTrack(input: NewTrack): Promise<Track> {
  const { rows } = await getPool().query<Track>(
    `INSERT INTO tracks
       (id, owner_telegram_id, title, artist, album, duration_seconds, telegram_file_id,
        mime_type, cover_image, cover_mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${TRACK_COLUMNS}`,
    [
      input.id,
      input.ownerTelegramId,
      input.title,
      input.artist,
      input.album,
      input.durationSeconds,
      input.telegramFileId,
      input.mimeType,
      input.coverImage,
      input.coverMimeType,
    ]
  );
  return rows[0];
}

export async function listTracks(ownerTelegramId: number): Promise<Track[]> {
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE owner_telegram_id = $1 ORDER BY created_at DESC`,
    [ownerTelegramId]
  );
  return rows;
}

export async function getTrack(
  id: string,
  ownerTelegramId: number
): Promise<Track | null> {
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = $1 AND owner_telegram_id = $2`,
    [id, ownerTelegramId]
  );
  return rows[0] ?? null;
}

/** Tracks whose artwork was never captured — the input to a cover backfill. */
export async function listTracksMissingCover(
  ownerTelegramId: number
): Promise<Pick<Track, "id" | "title" | "telegram_file_id">[]> {
  const { rows } = await getPool().query<
    Pick<Track, "id" | "title" | "telegram_file_id">
  >(
    `SELECT id, title, telegram_file_id FROM tracks
     WHERE owner_telegram_id = $1 AND cover_image IS NULL
     ORDER BY created_at DESC`,
    [ownerTelegramId]
  );
  return rows;
}

export interface TrackCover {
  coverImage: Buffer;
  coverMimeType: string | null;
}

export async function getTrackCover(
  id: string,
  ownerTelegramId: number
): Promise<TrackCover | null> {
  const { rows } = await getPool().query<{
    cover_image: Buffer | null;
    cover_mime_type: string | null;
  }>(
    `SELECT cover_image, cover_mime_type FROM tracks WHERE id = $1 AND owner_telegram_id = $2`,
    [id, ownerTelegramId]
  );
  const row = rows[0];
  if (!row?.cover_image) return null;
  return { coverImage: row.cover_image, coverMimeType: row.cover_mime_type };
}

export interface TrackTagUpdate {
  title?: string;
  artist?: string;
  album?: string;
}

export async function updateTrackTags(
  id: string,
  ownerTelegramId: number,
  fields: TrackTagUpdate
): Promise<Track | null> {
  const { rows } = await getPool().query<Track>(
    `UPDATE tracks
     SET title = COALESCE($3, title),
         artist = COALESCE($4, artist),
         album = COALESCE($5, album)
     WHERE id = $1 AND owner_telegram_id = $2
     RETURNING ${TRACK_COLUMNS}`,
    [id, ownerTelegramId, fields.title, fields.artist, fields.album]
  );
  return rows[0] ?? null;
}

export async function updateTrackCover(
  id: string,
  ownerTelegramId: number,
  coverImage: Buffer,
  coverMimeType: string
): Promise<Track | null> {
  const { rows } = await getPool().query<Track>(
    `UPDATE tracks SET cover_image = $3, cover_mime_type = $4
     WHERE id = $1 AND owner_telegram_id = $2
     RETURNING ${TRACK_COLUMNS}`,
    [id, ownerTelegramId, coverImage, coverMimeType]
  );
  return rows[0] ?? null;
}

export async function createPlaylist(
  ownerTelegramId: number,
  name: string
): Promise<Playlist> {
  const { rows } = await getPool().query<Playlist>(
    `INSERT INTO playlists (owner_telegram_id, name) VALUES ($1, $2) RETURNING *`,
    [ownerTelegramId, name]
  );
  return rows[0];
}

export async function listPlaylists(
  ownerTelegramId: number
): Promise<Playlist[]> {
  const { rows } = await getPool().query<Playlist>(
    `SELECT * FROM playlists WHERE owner_telegram_id = $1 ORDER BY created_at DESC`,
    [ownerTelegramId]
  );
  return rows;
}

export async function getPlaylist(
  id: string,
  ownerTelegramId: number
): Promise<Playlist | null> {
  const { rows } = await getPool().query<Playlist>(
    `SELECT * FROM playlists WHERE id = $1 AND owner_telegram_id = $2`,
    [id, ownerTelegramId]
  );
  return rows[0] ?? null;
}

export async function renamePlaylist(
  id: string,
  ownerTelegramId: number,
  name: string
): Promise<Playlist | null> {
  const { rows } = await getPool().query<Playlist>(
    `UPDATE playlists SET name = $3 WHERE id = $1 AND owner_telegram_id = $2 RETURNING *`,
    [id, ownerTelegramId, name]
  );
  return rows[0] ?? null;
}

export async function deletePlaylist(
  id: string,
  ownerTelegramId: number
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM playlists WHERE id = $1 AND owner_telegram_id = $2`,
    [id, ownerTelegramId]
  );
  return (rowCount ?? 0) > 0;
}

export async function listPlaylistTracks(
  playlistId: string,
  ownerTelegramId: number
): Promise<Track[]> {
  const { rows } = await getPool().query<Track>(
    `SELECT
       t.id, t.owner_telegram_id, t.title, t.artist, t.album, t.duration_seconds,
       t.telegram_file_id, t.mime_type, (t.cover_image IS NOT NULL) AS has_cover, t.created_at
     FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     JOIN playlists p ON p.id = pt.playlist_id
     WHERE pt.playlist_id = $1 AND p.owner_telegram_id = $2
     ORDER BY pt.position ASC`,
    [playlistId, ownerTelegramId]
  );
  return rows;
}

export async function addPlaylistTrack(
  playlistId: string,
  trackId: string,
  ownerTelegramId: number
): Promise<boolean> {
  const pool = getPool();

  // Both rows must belong to the caller — verified via the join conditions below,
  // not by trusting the IDs passed in.
  const { rows: ownedRows } = await pool.query(
    `SELECT
       (SELECT 1 FROM playlists WHERE id = $1 AND owner_telegram_id = $3) AS playlist_owned,
       (SELECT 1 FROM tracks WHERE id = $2 AND owner_telegram_id = $3) AS track_owned`,
    [playlistId, trackId, ownerTelegramId]
  );
  if (!ownedRows[0]?.playlist_owned || !ownedRows[0]?.track_owned) {
    return false;
  }

  const { rows: posRows } = await pool.query<{ next_position: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
     FROM playlist_tracks WHERE playlist_id = $1`,
    [playlistId]
  );

  await pool.query(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position)
     VALUES ($1, $2, $3)
     ON CONFLICT (playlist_id, track_id) DO NOTHING`,
    [playlistId, trackId, posRows[0].next_position]
  );
  return true;
}

export async function removePlaylistTrack(
  playlistId: string,
  trackId: string,
  ownerTelegramId: number
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM playlist_tracks pt
     USING playlists p
     WHERE pt.playlist_id = p.id
       AND p.owner_telegram_id = $3
       AND pt.playlist_id = $1
       AND pt.track_id = $2`,
    [playlistId, trackId, ownerTelegramId]
  );
  return (rowCount ?? 0) > 0;
}
