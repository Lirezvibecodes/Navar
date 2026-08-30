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

/**
 * Who put this track into Navaar, if there is anybody the viewer may be told
 * about. Null covers both halves of that: a listing that does not resolve the
 * name at all, and one that resolved it to nobody because naming them would
 * introduce a stranger.
 *
 * `you` is what the two places that show this disagree about rather than what
 * they compute differently — a library of your own uploads would say your name
 * on every row, so the row hides it and the player, which has one track and
 * room to be complete, says it.
 */
export function trackUploader(
  track: { uploader_id?: string | null; uploader_username?: string | null },
  meId: string | number | null | undefined
): { id: string; name: string; you: boolean } | null {
  if (!track.uploader_id || !track.uploader_username) return null;
  return {
    id: track.uploader_id,
    name: track.uploader_username,
    you: meId != null && String(track.uploader_id) === String(meId),
  };
}

/**
 * What to call somebody on screen.
 *
 * The Navaar handle first, because it is the name they chose and the only one
 * anybody else can look them up by. Their Telegram username is the fallback
 * for an account that has added tracks through the bot but never opened the
 * app, and a first name after that — a person with neither is rare enough to
 * be worth a plain label rather than a blank.
 *
 * One function rather than the same ternary in four views, so a person is
 * never called one thing in Social and another on their own page.
 */
export function personName(
  person:
    | {
        handle?: string | null;
        username?: string | null;
        first_name?: string | null;
      }
    | null
    | undefined
): string {
  if (!person) return "Someone";
  if (person.handle) return `@${person.handle}`;
  if (person.username) return `@${person.username}`;
  return person.first_name?.trim() || "Someone";
}

/**
 * "Alice", "Alice and Bob", or "Alice, Bob and 3 others" — never more than two
 * named, so a suggestion row stays one line whether two friends or twelve sit
 * behind it. `total` is the true count; the list may be a shorter sample.
 */
export function namesList(
  people: Parameters<typeof personName>[0][],
  total: number
): string {
  const named = people.slice(0, 2).map((p) => personName(p));
  const rest = total - named.length;
  if (named.length === 0) return "";
  if (rest > 0) return `${named.join(", ")} and ${pluralise(rest, "other")}`;
  return named.length === 1 ? named[0] : `${named[0]} and ${named[1]}`;
}
