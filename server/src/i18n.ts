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
const catalog = {} satisfies Record<string, Entry>;

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
