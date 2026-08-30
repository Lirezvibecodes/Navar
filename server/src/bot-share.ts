import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import {
  followPlaylist,
  getTrackForListener,
  getUserLanguage,
  playlistVisibleToRequester,
  redeemTrackShare,
  saveTrackToLibrary,
  searchOwnPlaylists,
  searchOwnTracks,
} from "./repo";
import type { Track } from "./types";
import { t } from "./i18n";

const UUID = "[0-9a-fA-F-]{36}";

function trackLabel(track: Pick<Track, "title" | "artist">): string {
  return [track.title, track.artist].filter(Boolean).join(" — ") || "Untitled";
}

/**
 * Handle a `?start=track_<id>` deep link.
 *
 * Reached by forwarding the bot's own share card to someone else, or by
 * pasting the raw link. Visibility is the same check every other read of the
 * track goes through — the sender may see it and the recipient not, and that
 * simply looks like the track not existing.
 */
export async function handleTrackShare(
  fromId: number,
  trackId: string,
  reply: (text: string, extra?: any) => Promise<unknown>
): Promise<void> {
  const lang = await getUserLanguage(fromId);
  const track = await getTrackForListener(trackId, fromId);
  if (!track) {
    await reply(t(lang, "share_track_unavailable"));
    return;
  }
  await reply(
    t(lang, "share_track_card", { title: trackLabel(track) }),
    Markup.inlineKeyboard([
      Markup.button.callback(t(lang, "btn_add_to_library"), `save_track_${track.id}`),
    ])
  );
}

/**
 * Handle a `?start=track_<token>` deep link — the opaque-token twin of
 * {@link handleTrackShare} above, reached from the public `/s/track/:token`
 * page rather than a forward inside Telegram. Where that one is gated by
 * whether the recipient can already see the track (a friend, a shared
 * playlist), this one has no such relationship to check: the token itself,
 * resolved by redeemTrackShare, is the entire authorization, which is why it
 * works for a stranger with no prior connection to the sender at all.
 */
export async function handleTrackShareToken(
  recipientTelegramId: number,
  token: string,
  reply: (text: string) => Promise<unknown>
): Promise<void> {
  const lang = await getUserLanguage(recipientTelegramId);
  const saved = await redeemTrackShare(token, recipientTelegramId);
  if (!saved) {
    await reply(t(lang, "share_track_unavailable"));
    return;
  }
  await reply(
    t(lang, saved.already ? "track_duplicate" : "track_added", {
      title: trackLabel(saved.track),
    })
  );
}

/** The playlist-shaped twin of {@link handleTrackShare}, same deep-link shape. */
export async function handlePlaylistShare(
  fromId: number,
  playlistId: string,
  reply: (text: string, extra?: any) => Promise<unknown>
): Promise<void> {
  const lang = await getUserLanguage(fromId);
  const playlist = await playlistVisibleToRequester(playlistId, fromId);
  if (!playlist) {
    await reply(t(lang, "share_playlist_unavailable"));
    return;
  }
  await reply(
    t(lang, "share_playlist_card", {
      name: playlist.name,
      count: playlist.track_count ?? 0,
    }),
    Markup.inlineKeyboard([
      Markup.button.callback(t(lang, "btn_follow_playlist"), `follow_playlist_${playlist.id}`),
    ])
  );
}

/**
 * The share card's own button, plus the native "Share via…" inline-query
 * search over the sender's own tracks and playlists. Both paths post the same
 * card shape a deep link would, so a recipient's tap behaves identically
 * whichever way the card reached them.
 */
export function registerShareActions(bot: Telegraf): void {
  bot.action(new RegExp(`^save_track_(${UUID})$`), async (ctx) => {
    const lang = await getUserLanguage(ctx.from.id);
    const saved = await saveTrackToLibrary(ctx.match[1], ctx.from.id);
    await ctx.answerCbQuery();
    if (!saved) {
      await editOrIgnore(ctx, t(lang, "share_track_unavailable"));
      return;
    }
    await editOrIgnore(
      ctx,
      t(lang, saved.already ? "track_duplicate" : "track_added", {
        title: trackLabel(saved.track),
      })
    );
  });

  bot.action(new RegExp(`^follow_playlist_(${UUID})$`), async (ctx) => {
    const lang = await getUserLanguage(ctx.from.id);
    const ok = await followPlaylist(ctx.from.id, ctx.match[1]);
    await ctx.answerCbQuery();
    await editOrIgnore(
      ctx,
      t(lang, ok ? "share_playlist_followed" : "share_playlist_unavailable")
    );
  });

  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query;
    const lang = await getUserLanguage(ctx.from.id);
    const [tracks, playlists] = await Promise.all([
      searchOwnTracks(ctx.from.id, query, 10),
      searchOwnPlaylists(ctx.from.id, query, 10),
    ]);

    const trackResults = tracks.map((track) => ({
      type: "article" as const,
      id: `track_${track.id}`,
      title: trackLabel(track),
      description: t(lang, "btn_add_to_library"),
      input_message_content: {
        message_text: t(lang, "share_track_card", { title: trackLabel(track) }),
      },
      reply_markup: Markup.inlineKeyboard([
        Markup.button.callback(t(lang, "btn_add_to_library"), `save_track_${track.id}`),
      ]).reply_markup,
    }));

    const playlistResults = playlists.map((playlist) => ({
      type: "article" as const,
      id: `playlist_${playlist.id}`,
      title: playlist.name,
      description: t(lang, "btn_follow_playlist"),
      input_message_content: {
        message_text: t(lang, "share_playlist_card", {
          name: playlist.name,
          count: playlist.track_count ?? 0,
        }),
      },
      reply_markup: Markup.inlineKeyboard([
        Markup.button.callback(t(lang, "btn_follow_playlist"), `follow_playlist_${playlist.id}`),
      ]).reply_markup,
    }));

    await ctx.answerInlineQuery([...trackResults, ...playlistResults], { cache_time: 0 });
  });
}

/** Replacing the card with its outcome, tolerating an already-edited message. */
async function editOrIgnore(
  ctx: { editMessageText: (text: string) => Promise<unknown> },
  text: string
): Promise<void> {
  try {
    await ctx.editMessageText(text);
  } catch {
    // Telegram rejects an edit that changes nothing, and the message may have
    // been deleted. Neither is worth surfacing.
  }
}
