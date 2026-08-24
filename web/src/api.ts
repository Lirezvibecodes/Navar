import type { Collection, Me, Person, Playlist, Track } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

let sessionToken: string | null = localStorage.getItem("session_token");

export function setSessionToken(token: string): void {
  sessionToken = token;
  localStorage.setItem("session_token", token);
}

export function getSessionToken(): string | null {
  return sessionToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function json(body: unknown): RequestInit["body"] {
  return JSON.stringify(body);
}

// --- Session ----------------------------------------------------------------

export async function authenticate(initData: string): Promise<Me> {
  const { token, user } = await request<{ token: string; user: Me }>(
    "/api/auth/telegram",
    { method: "POST", body: json({ initData }) }
  );
  setSessionToken(token);
  return user;
}

// --- Tracks -----------------------------------------------------------------

export function listTracks(filter?: "unsorted"): Promise<Track[]> {
  return request<Track[]>(`/api/tracks${filter ? `?filter=${filter}` : ""}`);
}

export type TrackEdit = Partial<{
  title: string | null;
  artist: string | null;
  album: string | null;
  lyrics: string | null;
  favorited: boolean;
}>;

export function updateTrack(id: string, fields: TrackEdit): Promise<Track> {
  return request<Track>(`/api/tracks/${id}`, {
    method: "PATCH",
    body: json(fields),
  });
}

export function getLyrics(id: string): Promise<string | null> {
  return request<{ lyrics: string | null }>(`/api/tracks/${id}/lyrics`).then(
    (r) => r.lyrics
  );
}

export function deleteTrack(id: string): Promise<void> {
  return request<void>(`/api/tracks/${id}`, { method: "DELETE" });
}

export function restoreTrack(id: string): Promise<Track> {
  return request<Track>(`/api/tracks/${id}/restore`, { method: "POST" });
}

/** Bulk delete returns the ids that actually moved, so undo puts back those. */
export function deleteTracks(trackIds: string[]): Promise<{ deleted: string[] }> {
  return request(`/api/tracks/bulk`, {
    method: "DELETE",
    body: json({ trackIds }),
  });
}

export function restoreTracks(
  trackIds: string[]
): Promise<{ restored: string[] }> {
  return request(`/api/tracks/bulk/restore`, {
    method: "POST",
    body: json({ trackIds }),
  });
}

export function uploadCover(id: string, file: File): Promise<Track> {
  const form = new FormData();
  form.append("cover", file);
  return request<Track>(`/api/tracks/${id}/cover`, {
    method: "POST",
    body: form,
  });
}

// The audio element and <img> cannot carry an Authorization header, so these
// two carry the session in the query string instead; requireAuth accepts both.
export function trackStreamUrl(id: string): string {
  return `${API_BASE}/api/tracks/${id}/stream?token=${encodeURIComponent(sessionToken ?? "")}`;
}

export function trackCoverUrl(id: string): string {
  return `${API_BASE}/api/tracks/${id}/cover?token=${encodeURIComponent(sessionToken ?? "")}`;
}

export function avatarUrl(userId: string | number): string {
  return `${API_BASE}/api/users/${userId}/avatar?token=${encodeURIComponent(sessionToken ?? "")}`;
}

// --- Playlists --------------------------------------------------------------

export function listPlaylists(): Promise<Playlist[]> {
  return request<Playlist[]>("/api/playlists");
}

export function createPlaylist(name: string): Promise<Playlist> {
  return request<Playlist>("/api/playlists", {
    method: "POST",
    body: json({ name }),
  });
}

/**
 * Rename a playlist, rewrite its description, or both. An omitted field is
 * left alone; `description: null` clears it.
 */
export function updatePlaylist(
  id: string,
  fields: { name?: string; description?: string | null }
): Promise<Playlist> {
  return request<Playlist>(`/api/playlists/${id}`, {
    method: "PATCH",
    body: json(fields),
  });
}

/** Pin a cover, or pass null to let the playlist pick its own again. */
export function setPlaylistCover(
  id: string,
  trackId: string | null
): Promise<Playlist> {
  return request<Playlist>(`/api/playlists/${id}/cover`, {
    method: "PUT",
    body: json({ trackId }),
  });
}

export function deletePlaylist(id: string): Promise<void> {
  return request<void>(`/api/playlists/${id}`, { method: "DELETE" });
}

export function listPlaylistTracks(id: string): Promise<Track[]> {
  return request<Track[]>(`/api/playlists/${id}/tracks`);
}

export function addTracksToPlaylist(
  playlistId: string,
  trackIds: string[]
): Promise<{ added: number }> {
  return request(`/api/playlists/${playlistId}/tracks/bulk`, {
    method: "POST",
    body: json({ trackIds }),
  });
}

export function removeTracksFromPlaylist(
  playlistId: string,
  trackIds: string[]
): Promise<{ removed: number }> {
  return request(`/api/playlists/${playlistId}/tracks/bulk`, {
    method: "DELETE",
    body: json({ trackIds }),
  });
}

// --- Albums and artists -----------------------------------------------------

export function listAlbums(): Promise<Collection[]> {
  return request<Collection[]>("/api/albums");
}

export function listArtists(): Promise<Collection[]> {
  return request<Collection[]>("/api/artists");
}

export function listAlbumTracks(name: string): Promise<Track[]> {
  return request<Track[]>(`/api/albums/${encodeURIComponent(name)}/tracks`);
}

export function listArtistTracks(name: string): Promise<Track[]> {
  return request<Track[]>(`/api/artists/${encodeURIComponent(name)}/tracks`);
}

// --- Friends ----------------------------------------------------------------

export function listFriends(): Promise<Person[]> {
  return request<Person[]>("/api/friends");
}

export function listFriendRequests(): Promise<{
  incoming: Person[];
  outgoing: string[];
}> {
  return request("/api/friends/pending");
}

/**
 * The playlists another person has opened up to you. An empty list is the
 * answer both for somebody who shares nothing and for somebody you are not
 * connected to — the server never distinguishes the two.
 */
export function listUserPlaylists(id: string | number): Promise<Playlist[]> {
  return request<Playlist[]>(`/api/users/${id}/playlists`);
}

export function friendInviteLink(): Promise<string> {
  return request<{ link: string }>("/api/friends/link").then((r) => r.link);
}

export function addFriend(id: string | number): Promise<{ outcome: string }> {
  return request(`/api/friends/${id}`, { method: "POST" });
}

export function acceptFriend(id: string | number): Promise<void> {
  return request<void>(`/api/friends/${id}/accept`, { method: "POST" });
}

export function removeFriend(id: string | number): Promise<void> {
  return request<void>(`/api/friends/${id}`, { method: "DELETE" });
}
