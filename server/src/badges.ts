/**
 * What endorsements add up to.
 *
 * An endorsement can only be given by somebody who has actually kept a track
 * they got from you, which makes the count a record of music that travelled
 * rather than of popularity. What the app shows is never that number: it shows
 * the tier the number falls in, and every chip renders at the same weight. A
 * chip that got bolder as the count climbed would be the count again, wearing
 * a costume, and would put two people who both earned the same tier on
 * visibly different footing.
 *
 * The thresholds below are guesses. Nobody has used this yet, so they are
 * placed where they are only because the ladder has to start somewhere — they
 * are meant to be retuned once there is real data, which is exactly why they
 * live here as one exported array rather than as literals scattered through
 * the queries and the views that read them.
 */
export interface BadgeTier {
  /**
   * Stable identifier, and the thing that goes over the wire. The label is
   * copy and may be rewritten; this may not, because the client tests against
   * it — the first tier is hidden everywhere except on your own profile.
   */
  id: string;
  label: string;
  /** Endorsements needed to reach this tier. Ascending; the first is zero. */
  min: number;
}

export const BADGE_TIERS: readonly BadgeTier[] = [
  // Everybody starts here, which is why it is shown nowhere but your own
  // profile: a row of Listener chips down the Social tab would say nothing
  // about anybody and would drown the tiers that mean something.
  { id: "listener", label: "Listener", min: 0 },
  { id: "selector", label: "Selector", min: 1 },
  { id: "tastemaker", label: "Tastemaker", min: 5 },
  { id: "curator", label: "Curator", min: 15 },
];

/** The default tier — held by anyone who has not been endorsed yet. */
export const BASE_TIER = BADGE_TIERS[0];

/** The highest tier this many endorsements reaches. */
export function tierFor(endorsements: number): BadgeTier {
  let tier = BASE_TIER;
  for (const candidate of BADGE_TIERS) {
    if (endorsements >= candidate.min) tier = candidate;
  }
  return tier;
}
