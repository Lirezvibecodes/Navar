import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import {
  claimBatchHint,
  countRecentTracks,
  createPlaylist,
  deletePlaylistIfEmpty,
  endIngestSession,
  getIngestSession,
  listIdleIngestSessions,
  markIngestStatusEdited,
  nameIngestBatch,
  setIngestAwaitingName,
  setIngestStatusMessage,
  startIngestSession,
  INGEST_IDLE_MINUTES,
  type IngestMode,
  type IngestSession,
} from "./repo";

/**
 * A batch is one message, edited in place.
 *
 * Forwarding thirty files used to mean thirty replies, which buries the chat
 * and makes the bot feel like it is shouting. Instead the mode confirmation
 * becomes a running status line that is edited as files land — there is never a
 * second message.
 */

/** Telegram rate-limits edits; one every couple of seconds is comfortable. */
const STATUS_EDIT_DEBOUNCE_MS = 2000;

/**
 * A burst that stops between debounce windows would leave the last file
 * uncounted on screen, so the skipped edit is retried once the window passes.
 * Process-local, and losing one to a restart only costs a stale number that the
 * closing summary corrects anyway.
 */
const trailingEdits = new Map<number, NodeJS.Timeout>();

/** The provisional name a playlist wears until the user gives it a real one. */
const PLACEHOLDER_PLAYLIST_NAME = "New playlist";

/** Files in a short window that make the /playlist hint worth offering. */
const HINT_THRESHOLD = 5;
const HINT_WINDOW_MINUTES = 5;

/** Below this, the status line is one sentence — a "currently" detail is noise. */
const FEW_TRACKS_THRESHOLD = 2;
/** Above this, a batch is long enough to earn a progress bar. */
const LARGE_BATCH_THRESHOLD = 10;
/** Width of the progress bar, in blocks. */
const PROGRESS_BAR_WIDTH = 10;

/** The slice of a Telegraf context this module needs, so it can be handed a stub. */
interface Replyable {
  chat?: { id: number };
  from?: { id: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reply(text: string, extra?: any): Promise<{ message_id: number; chat?: { id: number } }>;
}

/**
 * Open a batch. The reply this sends becomes the status message for the rest of
 * the session — the mode confirmation and the progress line are the same
 * message from the start, so nothing is ever superseded.
 */
export async function beginBatch(
  ctx: Replyable,
  mode: IngestMode
): Promise<void> {
  const userId = ctx.from!.id;

  // A playlist needs somewhere to put tracks before it has a name, so it starts
  // as a placeholder. If the batch ends up empty the placeholder is removed.
  const playlist =
    mode === "playlist" ? await createPlaylist(userId, PLACEHOLDER_PLAYLIST_NAME) : null;

  const session = await startIngestSession(userId, mode, playlist?.id ?? null);
  const sent = await ctx.reply(statusText(session), statusKeyboard(session) as never);
  await setIngestStatusMessage(userId, sent.chat?.id ?? ctx.chat!.id, sent.message_id);
}

/** Said whenever a batch command arrives with no batch open. */
const NOTHING_IN_PROGRESS =
  "Nothing in progress — forwarded files go straight to your library.";

/** `/unsorted` — stop filing things, without naming anything. */
export async function endBatchByCommand(
  bot: Telegraf,
  userId: number,
  reply: (text: string) => Promise<unknown>
): Promise<void> {
  const session = await getIngestSession(userId);
  if (!session) {
    await reply(NOTHING_IN_PROGRESS);
    return;
  }
  await finishBatch(bot, session, "user");
}

/**
 * `/done` — the typed form of the Done button, for people who reach for a
 * command rather than a button, and for a status message that has scrolled away.
 *
 * An unnamed playlist cannot simply be closed — it would be left called "New
 * playlist" — so /done on one asks for the name first and closes once it has it.
 * That is the same thing Done means either way: "I've finished sending."
 */
export async function finishBatchByCommand(
  bot: Telegraf,
  ctx: Replyable
): Promise<void> {
  const userId = ctx.from!.id;
  const session = await getIngestSession(userId);
  if (!session) {
    await ctx.reply(NOTHING_IN_PROGRESS);
    return;
  }
  if (needsName(session)) {
    await promptForName(ctx, session);
    return;
  }
  await finishBatch(bot, session, "user");
}

/** `/status` — what the open batch has picked up so far. */
export async function reportBatchStatus(
  userId: number,
  reply: (text: string) => Promise<unknown>
): Promise<void> {
  const session = await getIngestSession(userId);
  await reply(session ? statusText(session) : NOTHING_IN_PROGRESS);
}

/** Whether closing now would leave something without a name the user chose. */
function needsName(session: IngestSession): boolean {
  return session.mode === "playlist"
    ? session.added_count > 0
    : session.album_name === null;
}

/**
 * Ask for the batch's name and remember which message the answer will reply to,
 * so an unrelated message sent mid-batch is never read as the answer.
 */
async function promptForName(
  ctx: Replyable,
  session: IngestSession
): Promise<void> {
  const prompt = await ctx.reply(
    session.mode === "playlist"
      ? "What should the playlist be called?"
      : "What's the album called?",
    { reply_markup: { force_reply: true } }
  );
  await setIngestAwaitingName(ctx.from!.id, prompt.message_id);
}

/**
 * Update the running status line, at most once per debounce window.
 *
 * Called after every file. The skipped edits are the point: a forty-file batch
 * produces a handful of edits rather than forty.
 */
export function refreshStatus(bot: Telegraf, session: IngestSession): void {
  const userId = Number(session.telegram_user_id);
  const sinceEdit = session.status_edited_at
    ? Date.now() - Date.parse(session.status_edited_at)
    : Number.POSITIVE_INFINITY;

  if (sinceEdit >= STATUS_EDIT_DEBOUNCE_MS) {
    void editStatus(bot, session, statusText(session), statusKeyboard(session));
    return;
  }

  // Inside the window: hold the newest state and write it once the window ends.
  clearTimeout(trailingEdits.get(userId));
  trailingEdits.set(
    userId,
    setTimeout(() => {
      trailingEdits.delete(userId);
      void (async () => {
        // Re-read: the batch may have moved on, or ended, while we waited.
        const latest = await getIngestSession(userId);
        if (latest) {
          await editStatus(bot, latest, statusText(latest), statusKeyboard(latest));
        }
      })();
    }, STATUS_EDIT_DEBOUNCE_MS - sinceEdit).unref()
  );
}

/**
 * Close a batch and replace the status line with a summary that reconciles.
 *
 * The count on its own is not enough: somebody who forwarded twelve files and
 * reads "10 added" is left to work out which two are missing. So the summary
 * says how many were sent, how many landed, and names the ones that did not.
 */
export async function finishBatch(
  bot: Telegraf,
  session: IngestSession,
  reason: "user" | "expired"
): Promise<void> {
  const userId = Number(session.telegram_user_id);
  clearTimeout(trailingEdits.get(userId));
  trailingEdits.delete(userId);

  const closed = (await endIngestSession(userId)) ?? session;

  if (closed.mode === "playlist" && closed.playlist_id && closed.added_count === 0) {
    await deletePlaylistIfEmpty(closed.playlist_id);
  }

  await editStatus(bot, closed, summaryText(closed, reason), undefined);
}

/**
 * Close out batches nobody has touched for a while.
 *
 * Lazy on purpose: the free tier has no scheduler, and a timer would not
 * survive the service being put to sleep. Every incoming message is an
 * opportunity to notice, which is often enough that a stalled batch is closed
 * out within minutes of anyone using the bot.
 *
 * The user is told. A batch that simply stopped accepting files without saying
 * so is the version of this that loses somebody's album.
 */
export function maybeSweepIdleSessions(bot: Telegraf): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  void (async () => {
    try {
      for (const session of await listIdleIngestSessions()) {
        await finishBatch(bot, session, "expired");
      }
    } catch (err) {
      console.error("[ingest] idle-session sweep failed:", err);
    }
  })();
}

/** Throttle, so a forty-file batch does not run forty sweeps. */
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastSweepAt = 0;

/**
 * Offer the batch commands to somebody who is clearly doing a batch by hand.
 *
 * Discovery for /playlist cannot rely on the welcome message — by the time it
 * matters the welcome is far up the chat. The offer is made at the moment it
 * would have helped, and at most once a day, because a tip that repeats is
 * nagging.
 */
export async function maybeOfferBatchHint(
  userId: number,
  reply: (text: string) => Promise<unknown>
): Promise<void> {
  try {
    const recent = await countRecentTracks(userId, HINT_WINDOW_MINUTES);
    if (recent < HINT_THRESHOLD) return;
    if (!(await claimBatchHint(userId))) return;

    await reply(
      `That's ${recent} in a row. Next time, send /playlist first and I'll put the ` +
        "whole batch into one playlist — or /album to tag them as one album."
    );
  } catch (err) {
    console.error("[ingest] batch hint failed:", err);
  }
}

/** The [ Name it ] / [ Done ] buttons on the status message. */
export function registerIngestActions(bot: Telegraf): void {
  bot.action("ingest_name", async (ctx) => {
    const session = await getIngestSession(ctx.from.id);
    if (!session) {
      await ctx.answerCbQuery("That batch is already closed");
      return;
    }
    await ctx.answerCbQuery();
    await promptForName(ctx, session);
  });

  bot.action("ingest_done", async (ctx) => {
    const session = await getIngestSession(ctx.from.id);
    if (!session) {
      await ctx.answerCbQuery("That batch is already closed");
      return;
    }
    await ctx.answerCbQuery();
    await finishBatch(bot, session, "user");
  });
}

/**
 * Handle a text message that answers the force-reply naming prompt.
 *
 * Returns whether it was one, so the caller can leave anything else alone. The
 * reply is matched against the stored prompt id rather than accepted on the
 * strength of a session existing, so a message that happens to arrive mid-batch
 * is not swallowed as a name.
 */
export async function handleNameReply(
  bot: Telegraf,
  userId: number,
  text: string,
  replyToMessageId: number | undefined,
  reply: (text: string) => Promise<unknown>
): Promise<boolean> {
  const session = await getIngestSession(userId);
  if (
    !session?.awaiting_name ||
    !replyToMessageId ||
    replyToMessageId !== session.name_prompt_message_id
  ) {
    return false;
  }

  const name = text.trim();
  if (name.length === 0) {
    await reply("That's empty — send me a name, or ignore this and I'll leave it as it is.");
    return true;
  }

  await nameIngestBatch(session, name);
  await finishBatch(bot, { ...session, album_name: name }, "user");
  return true;
}

// ---------------------------------------------------------------------------
// Message copy
// ---------------------------------------------------------------------------

function batchLabel(session: IngestSession): string {
  if (session.mode === "album") {
    return session.album_name ? `Album: ${session.album_name}` : "Album";
  }
  return "Playlist";
}

/**
 * A block of {@link PROGRESS_BAR_WIDTH} characters that fills and wraps every
 * ten tracks — there is no fixed batch size to measure progress against, so
 * this reads as "still going" rather than "almost done".
 */
function progressBar(count: number): string {
  const filled = count % PROGRESS_BAR_WIDTH || PROGRESS_BAR_WIDTH;
  return "▓".repeat(filled) + "░".repeat(PROGRESS_BAR_WIDTH - filled);
}

function statusText(session: IngestSession): string {
  const lines = [
    session.added_count === 0
      ? `${batchLabel(session)} — forward the files.`
      : `${batchLabel(session)} — ${session.added_count} added.`,
  ];

  if (session.added_count >= LARGE_BATCH_THRESHOLD) {
    lines.push(progressBar(session.added_count));
  }

  if (session.added_count >= FEW_TRACKS_THRESHOLD && session.last_track_label) {
    lines.push(`Currently: ${session.last_track_label}`);
  }

  if (session.failed_names.length > 0) {
    lines.push(`${session.failed_names.length} didn't make it.`);
  }

  lines.push(
    session.mode === "album" && session.album_name
      ? "I'll keep tagging them. Tap Done when you're finished."
      : "Tap Name it when you're done and I'll ask what to call it."
  );

  return lines.join("\n");
}

function statusKeyboard(session: IngestSession) {
  const buttons = [Markup.button.callback("Name it", "ingest_name")];
  // Done only appears once there is a name to keep — otherwise it would leave a
  // playlist called "New playlist" behind.
  if (session.mode === "album" && session.album_name) {
    buttons.push(Markup.button.callback("Done", "ingest_done"));
  }
  return Markup.inlineKeyboard(buttons);
}

/**
 * "5 by Ivy, 4 by Cass, 3 more" — the top two artists by count, with whatever
 * is left (tracks by anyone else, plus tracks with no artist at all) folded
 * into a remainder so the numbers always add back up to `addedCount`. Null
 * when there is nothing worth grouping: one artist is just the batch itself.
 */
function artistSummary(tally: Record<string, number>, addedCount: number): string | null {
  const entries = Object.entries(tally).sort(([, a], [, b]) => b - a);
  if (entries.length < 2) return null;

  const top = entries.slice(0, 2);
  const shown = top.reduce((sum, [, count]) => sum + count, 0);
  const rest = addedCount - shown;

  const parts = top.map(([name, count]) => `${count} by ${name}`);
  if (rest > 0) parts.push(`${rest} more`);
  return parts.join(", ");
}

function summaryText(session: IngestSession, reason: "user" | "expired"): string {
  const failed = session.failed_names;
  const sent = session.added_count + failed.length;
  const lines: string[] = [];

  if (session.added_count === 0 && failed.length === 0) {
    lines.push(
      reason === "expired"
        ? `Closed the ${session.mode} — nothing arrived for ${INGEST_IDLE_MINUTES} minutes.`
        : `Closed the ${session.mode} — nothing was added.`
    );
    return lines.join("\n");
  }

  const where =
    session.mode === "album"
      ? session.album_name
        ? `tagged as ${session.album_name}`
        : "tagged"
      : "in the playlist";

  const grouping =
    session.added_count >= FEW_TRACKS_THRESHOLD
      ? artistSummary(session.artist_tally, session.added_count)
      : null;

  lines.push(
    failed.length === 0
      ? grouping
        ? `${session.added_count} tracks ${where} — ${grouping}.`
        : `${session.added_count} ${session.added_count === 1 ? "track" : "tracks"} ${where}.`
      : `You sent ${sent}. ${session.added_count} ${where}${grouping ? ` (${grouping})` : ""}, ${failed.length} didn't make it:`
  );

  if (failed.length > 0) {
    // Named, not counted: "two failed" leaves the user to work out which two.
    lines.push(failed.map((name) => `• ${name}`).join("\n"));
    lines.push("Forward those again and I'll retry them.");
  }

  if (reason === "expired") {
    lines.push(`Closed after ${INGEST_IDLE_MINUTES} quiet minutes.`);
  }

  return lines.join("\n");
}

/**
 * Rewrite the status message. Every failure mode here is benign — the message
 * was deleted, or the text is unchanged and Telegram refuses the edit — and
 * none of them should surface to the user or fail the ingest that triggered it.
 */
async function editStatus(
  bot: Telegraf,
  session: IngestSession,
  text: string,
  keyboard: ReturnType<typeof statusKeyboard> | undefined
): Promise<void> {
  if (!session.status_chat_id || !session.status_message_id) return;
  try {
    await bot.telegram.editMessageText(
      Number(session.status_chat_id),
      session.status_message_id,
      undefined,
      text,
      keyboard ? { reply_markup: keyboard.reply_markup } : { reply_markup: undefined }
    );
    await markIngestStatusEdited(Number(session.telegram_user_id)).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("message is not modified")) {
      console.warn("[ingest] could not update status message:", message);
    }
  }
}
