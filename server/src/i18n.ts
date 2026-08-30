import type { Lang } from "./repo";

export type { Lang };

type Vars = Record<string, string | number>;

interface Entry {
  en: string;
  fa: string;
}

/**
 * One entry per user-facing string the bot sends, in both languages side by
 * side — so a string can never ship in English with no Farsi counterpart, or
 * drift out of sync the way two separate files would let it. Values may hold
 * `{name}` placeholders, filled in by {@link t}.
 *
 * Keys are added here as each part of the bot is localized; nothing gets a
 * key until the flow that uses it exists.
 */
const catalog = {
  // Shown once, before the language is confirmed — in both languages at
  // once, since this is the one message sent before the bot can be sure
  // which of the two the reader wants. The same text either way `t` is
  // called with, so it renders identically regardless of the seeded guess.
  language_picker_prompt: {
    en:
      "Which language should I use? / از چه زبونی استفاده کنم؟\n\n" +
      "You can change this anytime from Settings. / " +
      "هر وقت خواستی می‌تونی از تنظیمات تغییرش بدی.",
    fa:
      "Which language should I use? / از چه زبونی استفاده کنم؟\n\n" +
      "You can change this anytime from Settings. / " +
      "هر وقت خواستی می‌تونی از تنظیمات تغییرش بدی.",
  },

  start_welcome: {
    en:
      "This is Navaar — your music, kept in Telegram.\n\n" +
      "Forward me any audio file and it lands in your library. Nothing is " +
      "uploaded anywhere else: the file stays in Telegram and Navaar keeps " +
      "the tags, the artwork, and where you left off.\n\n" +
      "Sending a whole album? Send /album first and I'll keep them " +
      "together.\n\n" +
      "Send a track to start, then open the app.\n\n" +
      "/playlist — turn the next batch you send into a playlist\n" +
      "/album — tag the next batch as one album\n" +
      "/done — finish the batch you're sending\n" +
      "/covers — fill in artwork for tracks that are missing it",
    fa:
      "این ناوار است — موسیقی‌ات، همین‌جا در تلگرام.\n\n" +
      "هر فایل صوتی را برایم فوروارد کن تا مستقیم به کتابخانه‌ات اضافه شود. " +
      "هیچ‌چیز جای دیگری آپلود نمی‌شود: فایل همان‌جا در تلگرام می‌ماند و " +
      "ناوار فقط تگ‌ها، کاور و جایی که ترکت را متوقف کرده‌ای را نگه " +
      "می‌دارد.\n\n" +
      "می‌خواهی یک آلبوم کامل بفرستی؟ اول /album را بفرست تا آهنگ‌ها را " +
      "کنار هم نگه دارم.\n\n" +
      "یک ترک بفرست تا شروع کنیم، بعد اپ را باز کن.\n\n" +
      "/playlist — دسته‌ی بعدی که می‌فرستی را به یک پلی‌لیست تبدیل می‌کند\n" +
      "/album — دسته‌ی بعدی را به‌عنوان یک آلبوم برچسب می‌زند\n" +
      "/done — دسته‌ای را که در حال فرستادنش هستی تمام می‌کند\n" +
      "/covers — برای ترک‌هایی که کاور ندارند، کاور پیدا می‌کند",
  },

  btn_open_navaar: { en: "Open Navaar", fa: "باز کردن ناوار" },
  btn_add_music: { en: "Add Music", fa: "افزودن موسیقی" },

  add_music_hint: {
    en:
      "Forward or send any audio file here and it lands straight in your " +
      "library — no typing required.",
    fa:
      "هر فایل صوتی را همین‌جا فوروارد یا ارسال کن تا مستقیم وارد کتابخانه‌ات " +
      "شود — نیازی به تایپ‌کردن نیست.",
  },
} satisfies Record<string, Entry>;

type Key = keyof typeof catalog;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/** Looks up `key` in `lang`, falling back to English for a missing entry. */
export function t(lang: Lang, key: Key, vars?: Vars): string {
  const entry: Entry = catalog[key];
  return fill(entry[lang] ?? entry.en, vars);
}
