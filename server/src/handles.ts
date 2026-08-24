/**
 * The rules a Navaar handle obeys.
 *
 * One module rather than a regex at each call site, because the sign-up form,
 * the change-handle route and the lookup route all have to agree about what a
 * handle is; the moment they disagree, somebody can claim a name that nobody
 * can then search for.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/**
 * Letters, digits and underscores, starting with a letter.
 *
 * Deliberately the same shape Telegram uses for its own usernames. People
 * arrive already knowing it, and a handle that would not have been a legal
 * Telegram username is one that looks wrong to everybody who reads it. The
 * leading letter keeps a handle from being mistaken for a user id.
 */
const SHAPE = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;

/**
 * Names the app answers to itself, which therefore cannot be worn by a person.
 * Short list, and it only needs to cover the words that would let somebody
 * pass themselves off as Navaar rather than as one of its users.
 */
const RESERVED = new Set(["navaar", "admin", "support", "help", "me", "bot"]);

/**
 * The handle in `raw`, or null if it is not one.
 *
 * A leading `@` is stripped rather than rejected: it is how everybody writes a
 * handle, and refusing the punctuation people naturally type is a validation
 * message where an obvious reading would have done. Case is preserved — the
 * owner's capitalisation is theirs — and uniqueness is enforced case-insensitively
 * in the database, so preserving it cannot let two people hold the same name.
 */
export function normaliseHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@+/, "");
  if (!SHAPE.test(handle)) return null;
  if (RESERVED.has(handle.toLowerCase())) return null;
  return handle;
}

/** Why a handle was refused, in words meant for the person who typed it. */
export const HANDLE_RULE =
  `A name is ${HANDLE_MIN}–${HANDLE_MAX} characters, starts with a letter, ` +
  `and uses only letters, numbers and underscores`;

/**
 * A first suggestion, from whatever the account already carries.
 *
 * Their Telegram username usually passes the shape unchanged, and a filled
 * field that is already correct turns first launch into one tap. Anything that
 * does not survive the rules yields nothing rather than a mangled guess — a
 * suggestion the person has to repair is worse than an empty field.
 */
export function suggestHandle(username: string | null | undefined): string {
  return (username && normaliseHandle(username)) || "";
}
