import type { TagTier } from "../types";

/**
 * Client mirror of server/src/tags.ts's TAG_TIERS. Kept in sync by hand, the
 * same way ProfileView.tsx's TIER_LADDER already tracks badges.ts's tiers —
 * these are presentation tokens, not something worth a network round trip to
 * fetch.
 */
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

/** Mirrors server/src/tags.ts's own MAX_EQUIPPED_TAGS — the server is what
 *  actually enforces this, this copy is only so the UI can grey out a fourth
 *  EQUIP button without a round trip to find out it would be refused. */
export const MAX_EQUIPPED_TAGS = 3;

/** Display order for the category filter strip and the card grid's grouping. */
export const TAG_CATEGORY_ORDER = ["listening", "library", "playlists", "social", "secret"] as const;

export const TAG_CATEGORY_LABEL: Record<(typeof TAG_CATEGORY_ORDER)[number], string> = {
  listening: "Listening",
  library: "Library",
  playlists: "Playlists",
  social: "Social",
  secret: "Secrets",
};
