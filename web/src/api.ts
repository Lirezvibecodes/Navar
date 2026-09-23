import type {
  ActivityItem,
  Collection,
  FriendPlaylist,
  HomePayload,
  ListeningNow,
  Me,
  Person,
  PersonResult,
  Playlist,
  PlaylistVisibility,
  SharedPlaylist,
  SharedPlaylistPage,
  SharedTrack,
  Suggestion,
  TagState,
  Track,
  UserProfile,
} from "./types";
import { cacheKey, dropCache, writeCache } from "./lib/cache";

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

/**
 * Claim the name this person is known by, or change it.
 *
 * Resolves with the handle the server actually stored — it strips a leading @
 * and keeps the capitalisation typed — and rejects with a message meant to be
 * shown as-is: a 409 says the name is taken, a 400 says what a name may be.
 */
export function setHandle(handle: string): Promise<{ handle: string }> {
  return request<{ handle: string }>("/api/me/handle", {
    method: "POST",
    body: json({ handle }),
  });
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

/**
 * Keep somebody else's track. What comes back is a copy of your own — a
 * different id, yours to retag, and it keeps working if they delete theirs.
 * Nothing is uploaded: a track is metadata and a Telegram file reference, so
 * the server copies a row and no audio moves anywhere.
 */
export function saveTrack(id: string): Promise<Track> {
  return request<Track>(`/api/tracks/${id}/save`, { method: "POST" });
}

/**
 * A link for handing this track to somebody outside Navaar entirely — a
 * public page with no session behind it, unlike saveTrack above which only
 * ever works between people who can already see each other's libraries.
 */
export function shareTrack(id: string): Promise<{ url: string; app_link: string | null }> {
  return request(`/api/tracks/${id}/share`, { method: "POST" });
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

/**
 * `profileOf`, when this cover is showing on somebody's profile, tells the
 * server which profile asked for it — the server checks that claim itself
 * against that person's own plays and background pick (see the backend's
 * `isProfileShowcaseCover`), so a friend-only track can still show its
 * picture next to text the profile already displays to anyone.
 */
export function trackCoverUrl(id: string, profileOf?: number): string {
  const profileParam = profileOf != null ? `&profileOf=${profileOf}` : "";
  return `${API_BASE}/api/tracks/${id}/cover?token=${encodeURIComponent(sessionToken ?? "")}${profileParam}`;
}

/**
 * `bust` forces a fresh fetch right after this session uploads its own new
 * picture — an <img> that already painted the old one never re-requests an
 * unchanged src, and nobody else's view of it needs to change until they next
 * open the app anyway, the same staleness the Telegram-photo refresh already
 * has.
 */
export function avatarUrl(userId: string | number, bust?: number): string {
  const v = bust != null ? `&v=${bust}` : "";
  return `${API_BASE}/api/users/${userId}/avatar?token=${encodeURIComponent(sessionToken ?? "")}${v}`;
}

// --- Playlists --------------------------------------------------------------

export function listPlaylists(): Promise<Playlist[]> {
  return request<Playlist[]>("/api/playlists");
}

/**
 * One playlist's own metadata, read-scoped rather than owner-scoped — this
 * resolves for a friend's playlist too, unlike listPlaylists.
 */
export function getPlaylist(id: string): Promise<Playlist> {
  return request<Playlist>(`/api/playlists/${id}`);
}

/** Playlists saved from other people's libraries, kept live by reference. */
export function listFollowedPlaylists(): Promise<FriendPlaylist[]> {
  return request<FriendPlaylist[]>("/api/playlists/followed");
}

export function followPlaylist(id: string): Promise<void> {
  return request<void>(`/api/playlists/${id}/follow`, { method: "POST" });
}

export function unfollowPlaylist(id: string): Promise<void> {
  return request<void>(`/api/playlists/${id}/follow`, { method: "DELETE" });
}

export function createPlaylist(name: string): Promise<Playlist> {
  return request<Playlist>("/api/playlists", {
    method: "POST",
    body: json({ name }),
  });
}

/**
 * Rename a playlist, rewrite its description, change who can see it, or any
 * combination. An omitted field is left alone; `description: null` clears it.
 *
 * Setting the visibility also mints or destroys the share link, so the
 * playlist that comes back is the one to read `share_slug` from.
 */
export function updatePlaylist(
  id: string,
  fields: {
    name?: string;
    description?: string | null;
    visibility?: PlaylistVisibility;
  }
): Promise<Playlist> {
  return request<Playlist>(`/api/playlists/${id}`, {
    method: "PATCH",
    body: json(fields),
  });
}

/**
 * Mint a new share link, which is the only way to kill the old one. Anyone
 * still holding the previous URL stops being able to open it.
 */
export function rotatePlaylistSlug(id: string): Promise<Playlist> {
  return request<Playlist>(`/api/playlists/${id}/rotate-slug`, {
    method: "POST",
  });
}

/**
 * The address to hand somebody, or null when the playlist has no live link.
 *
 * Same origin as the app itself — the Mini App and the share page are served
 * by the one service — so this is the whole of the link's construction.
 */
export function shareUrl(playlist: Playlist): string | null {
  if (playlist.visibility !== "public" || !playlist.share_slug) return null;
  return `${window.location.origin}/s/${playlist.share_slug}`;
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

/**
 * The URL of a playlist's own picture, or null when it has none.
 *
 * Takes the row rather than the id for two reasons: the caller cannot then ask
 * for a picture that is not there, and `updated_at` rides along in the query.
 * The path is stable across a change of cover, so without something in the URL
 * that moves, an <img> already showing the old picture would never go and
 * fetch the new one.
 */
export function playlistArtworkUrl(
  playlist: Pick<Playlist, "id" | "has_cover" | "updated_at">
): string | null {
  if (!playlist.has_cover) return null;
  const v = encodeURIComponent(playlist.updated_at);
  return `${API_BASE}/api/playlists/${playlist.id}/artwork?v=${v}&token=${encodeURIComponent(sessionToken ?? "")}`;
}

export function uploadPlaylistArtwork(id: string, file: Blob): Promise<Playlist> {
  const form = new FormData();
  form.append("cover", file, "cover.jpg");
  return request<Playlist>(`/api/playlists/${id}/artwork`, {
    method: "POST",
    body: form,
  });
}

/** Drop the uploaded picture, so the playlist goes back to picking its own. */
export function clearPlaylistArtwork(id: string): Promise<Playlist> {
  return request<Playlist>(`/api/playlists/${id}/artwork`, { method: "DELETE" });
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

export interface AlbumMetadata {
  releaseDate: string | null;
  trackCount: number | null;
}

export function getAlbumMetadata(name: string): Promise<AlbumMetadata> {
  return request<AlbumMetadata>(`/api/albums/${encodeURIComponent(name)}/metadata`);
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

/**
 * Who somebody else knows. Only answers for yourself or an actual friend —
 * the server 403s everyone else, matching the same rule a profile's own
 * `friend_count` is already gated by.
 */
export function listUserFriends(id: string | number): Promise<Person[]> {
  return request<Person[]>(`/api/users/${id}/friends`);
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

// --- Listening, history and activity ----------------------------------------

/**
 * Say what is playing, or pass null to say nothing is.
 *
 * Sent on a track change and on a slow heartbeat while playing, and never
 * while paused: what makes a status disappear is the server-side window
 * expiring, not a message from here. A WebView that is swiped away gets no
 * chance to send a goodbye, so nothing may depend on one arriving.
 */
export function setListeningStatus(trackId: string | null): Promise<void> {
  return request<void>("/api/me/listening-status", {
    method: "PATCH",
    body: json({ trackId }),
  });
}

/** Whether friends see any of that. Off until the profile switch turns it on. */
export function setListeningPrivacy(
  listeningPublic: boolean
): Promise<{ listening_public: boolean }> {
  return request("/api/me/privacy", {
    method: "PATCH",
    body: json({ listeningPublic }),
  });
}

/**
 * Log a play, once a track has genuinely been listened to.
 *
 * The local clock's minute-of-day and calendar date ride along because two
 * Navaar Tags key off them (a late-night streak, a specific minute) and the
 * server has no other way to know what midnight looked like from here — its
 * own clock is UTC, and guessing the listener's timezone from an IP is the
 * kind of thing this app does not do.
 */
export function recordPlay(trackId: string): Promise<void> {
  const now = new Date();
  return request<void>("/api/me/plays", {
    method: "POST",
    body: json({
      trackId,
      localMinuteOfDay: now.getHours() * 60 + now.getMinutes(),
      localDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`,
    }),
  }).then(() => {
    // Best-effort: a listening tag may have just unlocked. Dropped after the
    // request lands rather than awaited by the caller, same as every other
    // fire-and-forget play log in this app.
    dropCache(cacheKey.tags);
  });
}

/** Replace the Telegram profile photo with a picture chosen and cropped here. */
export function uploadAvatar(image: Blob): Promise<void> {
  const form = new FormData();
  form.append("avatar", image, "avatar.jpg");
  return request<void>("/api/me/avatar", { method: "POST", body: form });
}

/** Upload a rendered story card, getting back the HTTPS URL shareToStory needs. */
export function uploadStoryCard(image: Blob): Promise<{ url: string }> {
  const form = new FormData();
  form.append("card", image, "story.jpg");
  return request("/api/me/story-card", { method: "POST", body: form });
}

/**
 * Upload the frames for a karaoke story video. The server trims the track's
 * own audio to `[clipStart, clipStart + clipDuration]` and stitches it
 * against `frames`, each held on screen for its matching entry in
 * `durations` (seconds), into an MP4 — mirroring `uploadStoryCard`, just
 * with a manifest describing how the frames play back.
 */
export function uploadStoryVideo(
  trackId: string,
  frames: Blob[],
  durations: number[],
  clipStart: number,
  clipDuration: number
): Promise<{ url: string }> {
  const form = new FormData();
  form.append("trackId", trackId);
  form.append("manifest", JSON.stringify({ durations, clipStart, clipDuration }));
  frames.forEach((f, i) => form.append("frames", f, `frame_${i}.jpg`));
  return request("/api/me/story-video", { method: "POST", body: form });
}

/** One of the 8 presets from the accent-colour picker. */
export function setAccentColor(
  accentColor: string
): Promise<{ accent_color: string }> {
  return request("/api/me/accent", {
    method: "POST",
    body: json({ accentColor }),
  });
}

/**
 * The whole first screen, in one call.
 *
 * One request rather than one per shelf, because Home is what wakes a sleeping
 * instance and five calls would each pay for that wake. Sections that have
 * nothing behind them are missing from the response rather than empty in it.
 */
export function getHome(): Promise<HomePayload> {
  return request<HomePayload>("/api/home");
}

/**
 * Friends playing something right now. Anybody who has not turned listening on,
 * or who stopped a while ago, is simply absent — there is no hidden row to
 * render, because a row saying somebody is private tells you the one thing they
 * asked not to tell you.
 */
export function listFriendsListening(): Promise<ListeningNow[]> {
  return request<ListeningNow[]>("/api/friends/listening");
}

/**
 * Everything the Social tab shows, in one call.
 *
 * The only endpoint this app refetches on a schedule — see SocialView for the
 * rule that governs it: while its tab is on screen, at most once every 30s.
 */
export function socialActivity(): Promise<ActivityItem[]> {
  return request<ActivityItem[]>("/api/social/activity");
}

// --- Discovery and profiles -------------------------------------------------

/**
 * Look for people by the start of their name.
 *
 * A query too short to be a search comes back as an empty list rather than an
 * error, so a screen that calls this on every keystroke has nothing to catch.
 */
export function searchPeople(query: string): Promise<PersonResult[]> {
  return request<PersonResult[]>(
    `/api/users/search?q=${encodeURIComponent(query)}`
  );
}

/**
 * People your friends know.
 *
 * Asked once when the Social tab opens and deliberately not part of the
 * activity payload above: that one refetches every thirty seconds, and the
 * friend graph cannot have changed in the meantime.
 */
export function friendSuggestions(): Promise<Suggestion[]> {
  return request<Suggestion[]>("/api/social/suggestions");
}

/** Somebody's page, already narrowed to what you are allowed to see of it. */
export function getProfile(id: string | number): Promise<UserProfile> {
  return request<UserProfile>(`/api/users/${id}/profile`);
}

/** Pin a track's cover as your profile header's background, or pass null to
 *  let it go back to a wash of your most-played track. */
export function setProfileBackground(trackId: string | null): Promise<void> {
  return request("/api/me/background", {
    method: "POST",
    body: json({ trackId }),
  });
}

// --- The share page ---------------------------------------------------------
//
// The only calls in this file that carry no session, because the page they
// serve has none. The slug in the path is the entire credential — which is
// why the app calls this level "Anyone with the link" and never "Public".

export function getSharedPlaylist(slug: string): Promise<SharedPlaylistPage> {
  return request<SharedPlaylistPage>(`/api/shared/${encodeURIComponent(slug)}`);
}

export function listSharedTracks(slug: string): Promise<SharedTrack[]> {
  return request<SharedTrack[]>(`/api/shared/${encodeURIComponent(slug)}/tracks`);
}

/**
 * Media URLs for the share page. No token — there is nobody to authenticate —
 * and the slug travels with every one of them, because the server proves the
 * track sits in that playlist rather than trusting the id.
 */
export function sharedStreamUrl(slug: string, trackId: string): string {
  return `${API_BASE}/api/shared/${encodeURIComponent(slug)}/tracks/${trackId}/stream`;
}

export function sharedTrackCoverUrl(slug: string, trackId: string): string {
  return `${API_BASE}/api/shared/${encodeURIComponent(slug)}/tracks/${trackId}/cover`;
}

export function sharedPlaylistCoverUrl(playlist: SharedPlaylist): string | null {
  if (!playlist.has_cover) return null;
  return `${API_BASE}/api/shared/${encodeURIComponent(playlist.share_slug)}/cover`;
}

// --- Navaar Tags --------------------------------------------------------------

/** All 29 tags, unlocked or not, for the caller. One round trip, no N+1. */
export function getTags(): Promise<TagState[]> {
  return request<TagState[]>("/api/tags");
}

/** Pin up to 3 unlocked tags to the profile, in the order given. */
export function setEquippedTags(tagIds: string[]): Promise<TagState[]> {
  return request<TagState[]>("/api/tags/equipped", {
    method: "PUT",
    body: json({ tagIds }),
  }).then((tags) => {
    writeCache(cacheKey.tags, tags);
    return tags;
  });
}
