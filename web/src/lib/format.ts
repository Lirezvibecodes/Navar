/** `2:31`, or `1:02:31` once an hour is on the clock. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** The right-hand side of the scrubber: what is left, not where we are. */
export function formatRemaining(
  position: number,
  duration: number | null | undefined
): string {
  if (duration == null || !Number.isFinite(duration)) return "--:--";
  return `-${formatDuration(Math.max(0, duration - position))}`;
}

/** "20m", "3h", "2d" — activity rows and nothing longer-winded than that. */
export function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** What to print when a file arrived with no title tag. */
export function trackTitle(track: { title: string | null }): string {
  return track.title?.trim() || "Untitled";
}

export function trackArtist(track: { artist: string | null }): string {
  return track.artist?.trim() || "Unknown artist";
}

export function pluralise(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
