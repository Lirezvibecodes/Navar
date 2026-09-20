import { LockIcon, TagIcon } from "../icons";
import { TAG_TIERS } from "../lib/tagTiers";
import { TAG_SHAPE_ICONS } from "../lib/tagShapeIcons";
import { haptic } from "../telegram";
import type { TagState, TagTier } from "../types";

/**
 * One card in the Tags grid: unlocked, locked, or secret-locked.
 *
 * The server's own redaction only goes so far — `GET /api/tags` still carries
 * the real `id` and `name` for a locked secret tag (see `getTagStates` in
 * `repo.ts`), because the id is needed to key the row and the name is needed
 * the instant it unlocks. The "?"-silhouette with no name is a presentation
 * choice made here, not something the payload enforces: a secret tag's own
 * `flavor` field is already the vague `lockedClue` while it's locked, so that
 * much is safe to show as the tease it's written to be.
 */
export function TagCard({ tag, onOpen }: { tag: TagState; onOpen: () => void }) {
  const tier = TAG_TIERS[tag.tier];
  const unlocked = tag.unlocked;
  const secretLocked = tag.secret && !unlocked;
  const Icon = TAG_SHAPE_ICONS[tag.id] ?? TagIcon;
  const pct =
    !unlocked && !tag.secret && tag.target
      ? Math.max(0, Math.min(100, Math.round(((tag.progress ?? 0) / tag.target) * 100)))
      : null;

  return (
    <button
      className="nav-press nav-fade"
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 128,
        padding: "13px 13px 12px",
        borderRadius: 16,
        textAlign: "left",
        background: unlocked ? tier.soft : "rgba(255,255,255,.03)",
        border: `1px solid ${unlocked ? tier.border : "rgba(255,255,255,.07)"}`,
        opacity: unlocked ? 1 : secretLocked ? 0.62 : 0.8,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          width: 34,
          height: 34,
          borderRadius: 10,
          flex: "none",
          background: unlocked ? tier.gradient ?? tier.color : "rgba(255,255,255,.06)",
          color: unlocked ? "#0A0A0A" : "rgba(255,255,255,.4)",
          fontSize: 15,
          fontWeight: 800,
        }}
      >
        {secretLocked ? "?" : unlocked ? <Icon size={17} /> : <LockIcon size={16} />}
      </span>

      <span style={{ minWidth: 0 }}>
        <span
          className="nav-clip"
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: unlocked ? "#fff" : "rgba(255,255,255,.78)",
          }}
        >
          {secretLocked ? "Secret Tag" : tag.name}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            marginTop: 3,
            color: unlocked ? tier.color : "rgba(255,255,255,.35)",
          }}
        >
          {tier.label}
          {unlocked && tag.secret ? " · Secret" : ""}
        </span>
      </span>

      <span
        style={{
          fontSize: 10.5,
          lineHeight: 1.35,
          color: "var(--color-nav-muted)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {tag.flavor}
      </span>

      {pct != null ? (
        <span
          style={{
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,.08)",
            overflow: "hidden",
            marginTop: 2,
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${pct}%`,
              borderRadius: 2,
              background: "var(--color-nav-action)",
            }}
          />
        </span>
      ) : null}
    </button>
  );
}

/**
 * A single equipped tag, rendered as a small pill — the header row of the
 * Tags screen shows up to 3 of these. Kept here rather than duplicated at
 * each call site, since every use is literally the same tier-colored
 * TagIcon-plus-name button, just at one of two sizes.
 *
 * `small` drops it to the exact dimensions the profile header's old tier
 * chip used to be (18px tall, 9px type) — that chip was retired in favour
 * of the primary equipped tag living in the same spot, and the replacement
 * was asked to keep its predecessor's size rather than resize the row
 * around it.
 */
export function TagPlaque({
  id,
  name,
  tier,
  onOpen,
  small,
}: {
  id: string;
  name: string;
  tier: TagTier;
  onOpen: () => void;
  small?: boolean;
}) {
  const token = TAG_TIERS[tier];
  const Icon = TAG_SHAPE_ICONS[id] ?? TagIcon;
  return (
    <button
      className="nav-glass nav-press"
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      style={{
        display: "inline-flex",
        flexShrink: 0,
        alignItems: "center",
        gap: small ? 3 : 6,
        height: small ? 18 : 26,
        padding: small ? "0 7px" : "0 10px",
        borderRadius: small ? 9 : 13,
        fontSize: small ? 9 : 11,
        fontWeight: small ? 600 : 700,
        color: token.color,
        border: `1px solid ${token.border}`,
      }}
    >
      <Icon size={small ? 9 : 11} />
      {name}
    </button>
  );
}
