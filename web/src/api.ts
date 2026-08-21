import type { Playlist, Track } from "./types";

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

export async function authenticate(initData: string): Promise<string> {
  const { token } = await request<{ token: string }>("/api/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ initData }),
  });
  setSessionToken(token);
  return token;
}

export function listTracks(): Promise<Track[]> {
  return request<Track[]>("/api/tracks");
}

export function updateTrack(
  id: string,
  fields: Partial<Pick<Track, "title" | "artist" | "album">>
): Promise<Track> {
  return request<Track>(`/api/tracks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
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

export function trackStreamUrl(id: string): string {
  return `${API_BASE}/api/tracks/${id}/stream?token=${encodeURIComponent(sessionToken ?? "")}`;
}

export function trackCoverUrl(id: string): string {
  return `${API_BASE}/api/tracks/${id}/cover?token=${encodeURIComponent(sessionToken ?? "")}`;
}

export function listPlaylists(): Promise<Playlist[]> {
  return request<Playlist[]>("/api/playlists");
}

export function createPlaylist(name: string): Promise<Playlist> {
  return request<Playlist>("/api/playlists", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function renamePlaylist(id: string, name: string): Promise<Playlist> {
  return request<Playlist>(`/api/playlists/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deletePlaylist(id: string): Promise<void> {
  return request<void>(`/api/playlists/${id}`, { method: "DELETE" });
}

export function listPlaylistTracks(id: string): Promise<Track[]> {
  return request<Track[]>(`/api/playlists/${id}/tracks`);
}

export function addTrackToPlaylist(
  playlistId: string,
  trackId: string
): Promise<void> {
  return request<void>(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({ trackId }),
  });
}

export function removeTrackFromPlaylist(
  playlistId: string,
  trackId: string
): Promise<void> {
  return request<void>(`/api/playlists/${playlistId}/tracks/${trackId}`, {
    method: "DELETE",
  });
}
