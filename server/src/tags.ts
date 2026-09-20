/**
 * Navaar Tags: the app's one collectible music-identity layer. (An earlier,
 * endorsement-based Taste Tier ladder lived in badges.ts and showed a
 * separate chip on the profile header; it has been retired in favor of tags,
 * which is why this catalogue no longer has a second system to stay distinct
 * from.)
 *
 * This file is the catalogue only: ids, names, tiers and copy. The
 * conditions themselves — what has to be true for a tag to unlock — live in
 * tagEvaluator.ts.
 */

export type TagTier = "copper" | "chrome" | "gold" | "emerald" | "cosmic";

export interface TagTierToken {
  label: string;
  color: string;
  soft: string;
  border: string;
  /** Cosmic only: the second stop of its purple-to-cyan gradient. */
  secondary?: string;
  /** Cosmic only: the premium multicolor treatment nothing else gets. */
  gradient?: string;
}

/**
 * Rarity tokens, ascending. Tier color is the accent a card and a locked-clue
 * chip render with — never the whole card background, and every tier but
 * Cosmic stays a single flat color so Cosmic reads as genuinely rarer rather
 * than one gradient among several.
 */
export const TAG_TIERS: Readonly<Record<TagTier, TagTierToken>> = {
  copper: {
    label: "Copper",
    color: "#D9824B",
    soft: "rgba(217,130,75,.14)",
    border: "rgba(217,130,75,.42)",
  },
  chrome: {
    label: "Chrome",
    color: "#C7D2E0",
    soft: "rgba(199,210,224,.12)",
    border: "rgba(199,210,224,.35)",
  },
  gold: {
    label: "Gold",
    color: "#F6C945",
    soft: "rgba(246,201,69,.13)",
    border: "rgba(246,201,69,.40)",
  },
  emerald: {
    label: "Emerald",
    color: "#34D399",
    soft: "rgba(52,211,153,.13)",
    border: "rgba(52,211,153,.40)",
  },
  cosmic: {
    label: "Cosmic",
    color: "#A855F7",
    secondary: "#22D3EE",
    soft: "rgba(168,85,247,.14)",
    border: "rgba(168,85,247,.48)",
    gradient: "linear-gradient(120deg,#A855F7,#22D3EE)",
  },
};

export type TagCategory = "listening" | "library" | "playlists" | "social" | "secret";

export interface TagDefinition {
  id: string;
  name: string;
  category: TagCategory;
  tier: TagTier;
  /** Shown once unlocked, and on a locked non-secret card's condition line. */
  flavor: string;
  /**
   * What a locked card shows instead of the real condition. Every public tag
   * doubles its own plain-language unlock condition as this line; secret tags
   * get a deliberately vague one that never names the number or the rule.
   */
  lockedClue: string;
  secret?: boolean;
}

/**
 * All 30 launch tags. Ids, names, tiers and copy are verbatim from the
 * product spec — this is the one place they are written down, so a threshold
 * or a line of flavor text is never re-typed (and never drifts) anywhere else.
 */
export const TAG_CATALOGUE: readonly TagDefinition[] = [
  // ---- Listening ----------------------------------------------------
  {
    id: "first_spin",
    name: "First Spin",
    category: "listening",
    tier: "copper",
    flavor: "Everybody starts somewhere.",
    lockedClue: "First qualified play.",
  },
  {
    id: "regular",
    name: "Regular",
    category: "listening",
    tier: "copper",
    flavor: "You actually come back.",
    lockedClue: "Qualified listening activity on 7 distinct calendar days.",
  },
  {
    id: "deep_listener",
    name: "Deep Listener",
    category: "listening",
    tier: "chrome",
    flavor: "You don't just press play.",
    lockedClue: "10 lifetime listening hours.",
  },
  {
    id: "midnight_radio",
    name: "Midnight Radio",
    category: "listening",
    tier: "gold",
    flavor: "Sleep was never part of the plan.",
    lockedClue: "25 qualified plays between 00:00 and 05:00, your local time.",
  },
  {
    id: "repeat_offender",
    name: "Repeat Offender",
    category: "listening",
    tier: "copper",
    flavor: "Again? Seriously?",
    lockedClue: "Same track reaches 10 qualified plays.",
  },
  {
    id: "one_song_cult",
    name: "One Song Cult",
    category: "listening",
    tier: "emerald",
    flavor: "There are other songs, you know.",
    lockedClue: "Same track reaches 50 qualified plays.",
  },
  {
    id: "eclectic",
    name: "Eclectic",
    category: "listening",
    tier: "gold",
    flavor: "Your library refuses to pick a lane.",
    lockedClue: "Qualified listening from 50 unique artists.",
  },

  // ---- Library / collection ------------------------------------------
  {
    id: "crate_digger",
    name: "Crate Digger",
    category: "library",
    tier: "copper",
    flavor: "The crate is getting dangerous.",
    lockedClue: "Own 25 tracks.",
  },
  {
    id: "crate_goblin",
    name: "Crate Goblin",
    category: "library",
    tier: "gold",
    flavor: "You were supposed to organize these.",
    lockedClue: "Own 100 tracks.",
  },
  {
    id: "vault_keeper",
    name: "Vault Keeper",
    category: "library",
    tier: "emerald",
    flavor: "Nobody is touching the vault.",
    lockedClue: "Own 250 tracks.",
  },
  {
    id: "album_nerd",
    name: "Album Nerd",
    category: "library",
    tier: "chrome",
    flavor: "Singles are not enough.",
    lockedClue: "Own tracks from 20 distinct albums.",
  },
  {
    id: "scene_builder",
    name: "Scene Builder",
    category: "library",
    tier: "gold",
    flavor: "You are building a whole scene.",
    lockedClue: "Own music from 50 unique artists.",
  },
  {
    id: "art_director",
    name: "Art Director",
    category: "library",
    tier: "chrome",
    flavor: "The metadata has to look good too.",
    lockedClue: "10 owned tracks have cover artwork.",
  },
  {
    id: "metadata_police",
    name: "Metadata Police",
    category: "library",
    tier: "gold",
    flavor: "Put the correct name on the file.",
    lockedClue: "At least 50 owned tracks, 90% with complete title, artist and album.",
  },

  // ---- Playlists / creation -------------------------------------------
  {
    id: "playlist_architect",
    name: "Playlist Architect",
    category: "playlists",
    tier: "copper",
    flavor: "You have opinions about sequencing.",
    lockedClue: "Create 5 playlists.",
  },
  {
    id: "mixtape_machine",
    name: "Mixtape Machine",
    category: "playlists",
    tier: "chrome",
    flavor: "The queue became a project.",
    lockedClue: "Create a playlist with 25 or more tracks.",
  },
  {
    id: "track_pusher",
    name: "Track Pusher",
    category: "playlists",
    tier: "chrome",
    flavor: "Listen to this. Trust me.",
    lockedClue: "Share 10 distinct tracks with other people.",
  },
  {
    id: "mixtape_dealer",
    name: "Mixtape Dealer",
    category: "playlists",
    tier: "gold",
    flavor: "People are actually buying what you're selling.",
    lockedClue: "One of your playlists reaches 3 followers.",
  },
  {
    id: "public_radio",
    name: "Public Radio",
    category: "playlists",
    tier: "emerald",
    flavor: "You have an audience now.",
    lockedClue: "A public playlist reaches 5 followers.",
  },
  {
    id: "group_chat_dj",
    name: "Group Chat DJ",
    category: "playlists",
    tier: "gold",
    flavor: "The group chat has a soundtrack.",
    lockedClue: "A playlist tied to a Telegram group chat reaches 3 tracks.",
  },

  // ---- Social -----------------------------------------------------------
  {
    id: "first_contact",
    name: "First Contact",
    category: "social",
    tier: "copper",
    flavor: "You found your people.",
    lockedClue: "First accepted friendship.",
  },
  {
    id: "social_butterfly",
    name: "Social Butterfly",
    category: "social",
    tier: "chrome",
    flavor: "You know people.",
    lockedClue: "5 active friends.",
  },
  {
    id: "connector",
    name: "Connector",
    category: "social",
    tier: "gold",
    flavor: "Everyone somehow knows you.",
    lockedClue: "10 active friends.",
  },
  {
    id: "taste_dealer",
    name: "Taste Dealer",
    category: "social",
    tier: "gold",
    flavor: "Your taste is travelling.",
    lockedClue: "5 different people save a track that started with you.",
  },
  {
    id: "the_plug",
    name: "The Plug",
    category: "social",
    tier: "emerald",
    flavor: "You put people on.",
    lockedClue: "10 tracks you brought in are saved by other people.",
  },

  // ---- Secret -------------------------------------------------------
  // Locked clues here are the spec's own vague lines, never the real rule —
  // the exact condition (a day count, a minute window, a threshold) is only
  // ever checked server-side and is never present in a locked payload.
  {
    id: "necromancer",
    name: "Necromancer",
    category: "secret",
    tier: "emerald",
    flavor: "You brought one back from the dead.",
    lockedClue: "Some songs refuse to stay dead.",
    secret: true,
  },
  {
    id: "rabbit_hole",
    name: "Rabbit Hole",
    category: "secret",
    tier: "gold",
    flavor: "You went in way too deep.",
    lockedClue: "One artist. Then another song. And another.",
    secret: true,
  },
  {
    id: "four_four_four",
    name: "4:44 Club",
    category: "secret",
    tier: "cosmic",
    flavor: "You were there.",
    lockedClue: "Somewhere between sleep and a terrible decision.",
    secret: true,
  },
  {
    id: "obsessive",
    name: "Obsessive",
    category: "secret",
    tier: "cosmic",
    flavor: "You have heard this one enough.",
    lockedClue: "There is listening. Then there is this.",
    secret: true,
  },
  {
    id: "archivist",
    name: "Archivist",
    category: "secret",
    tier: "cosmic",
    flavor: "The archive is now officially absurd.",
    lockedClue: "You are not collecting music anymore. You are preserving history.",
    secret: true,
  },
];

export const TAG_BY_ID: ReadonlyMap<string, TagDefinition> = new Map(
  TAG_CATALOGUE.map((tag) => [tag.id, tag])
);

export const MAX_EQUIPPED_TAGS = 3;

/**
 * What GET /api/tags carries per tag. `progress`/`target` are null for any
 * still-locked secret tag (and for a public tag where a live percentage isn't
 * worth computing) — the client is never handed a number it could reconstruct
 * a hidden threshold from.
 */
export interface TagState {
  id: string;
  name: string;
  category: TagCategory;
  tier: TagTier;
  secret: boolean;
  unlocked: boolean;
  unlocked_at: string | null;
  equipped: boolean;
  /** The line a card shows: flavor once unlocked, lockedClue while locked. */
  flavor: string;
  progress: number | null;
  target: number | null;
}
