import { CheckIcon, LockIcon, TagIcon } from "../icons";
import { TAG_TIERS } from "../lib/tagTiers";
import { Sheet, SheetItem } from "./ui";
import type { TagCategory, TagState, TagTier } from "../types";

/**
 * What the sheet needs from a tag, whatever shape it arrived in.
 *
 * A `TagState` (the Tags screen's own data) satisfies this directly. A tag
 * pinned to somebody else's profile is an `EquippedTag`, which carries none
 * of `unlocked`/`unlocked_at`/`progress`/`target` because an equipped tag is
 * always unlocked — the caller fills those three in rather than this file
 * inventing a second shape.
 */
export interface TagDetailInfo {
  id: string;
  name: string;
  category: TagCategory;
  tier: TagTier;
  secret: boolean;
  flavor: string;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number | null;
  target: number | null;
}

export function detailFromState(tag: TagState): TagDetailInfo {
  return tag;
}

function formatUnlockDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The sheet behind a tag card, and behind an equipped plaque on a profile.
 *
 * `editable` turns the EQUIP/REMOVE row on — off entirely on somebody else's
 * profile, where a plaque is read-only. A locked tag's real name/flavor are
 * suppressed the same way `TagCard` suppresses them, for the same reason: the
 * payload behind a locked secret tag still carries the true id and name, so
 * hiding them is this file's job, not the server's.
 */
export function TagDetailSheet({
  tag,
  open,
  onClose,
  editable,
  equipped,
  canEquipMore,
  onEquip,
  onUnequip,
}: {
  tag: TagDetailInfo | null;
  open: boolean;
  onClose: () => void;
  editable: boolean;
  equipped: boolean;
  canEquipMore: boolean;
  onEquip?: () => void;
  onUnequip?: () => void;
}) {
  if (!tag) return <Sheet open={open} onClose={onClose}><span /></Sheet>;

  const tier = TAG_TIERS[tag.tier];
  const secretLocked = tag.secret && !tag.unlocked;
  const pct =
    !tag.unlocked && !tag.secret && tag.target
      ? Math.max(0, Math.min(100, Math.round(((tag.progress ?? 0) / tag.target) * 100)))
      : null;

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "8px 16px 18px" }}>
        <span
          aria-hidden="true"
          style={{
            display: "grid",
            placeItems: "center",
            width: 56,
            height: 56,
            borderRadius: 16,
            background: tag.unlocked ? tier.gradient ?? tier.color : "rgba(255,255,255,.06)",
            color: tag.unlocked ? "#0A0A0A" : "rgba(255,255,255,.4)",
            fontSize: 24,
            fontWeight: 800,
          }}
        >
          {secretLocked ? "?" : tag.unlocked ? <TagIcon size={28} /> : <LockIcon size={26} />}
        </span>

        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", textAlign: "center" }}>
          {secretLocked ? "Secret Tag" : tag.name}
        </span>

        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: tag.unlocked ? tier.color : "rgba(255,255,255,.4)",
          }}
        >
          {tier.label}
          {tag.unlocked && tag.secret ? " · Secret" : ""}
        </span>

        <span
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--color-nav-muted)",
            textAlign: "center",
            maxWidth: 280,
          }}
        >
          {tag.flavor}
        </span>

        {tag.unlocked && tag.unlocked_at ? (
          <span style={{ fontSize: 11, color: "var(--color-nav-muted)" }}>
            Unlocked {formatUnlockDate(tag.unlocked_at)}
          </span>
        ) : null}

        {pct != null ? (
          <div style={{ width: "100%", marginTop: 4 }}>
            <div
              style={{
                height: 5,
                borderRadius: 3,
                background: "rgba(255,255,255,.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  borderRadius: 3,
                  background: "var(--color-nav-action)",
                }}
              />
            </div>
            <div style={{ fontSize: 10.5, color: "var(--color-nav-muted)", marginTop: 5, textAlign: "center" }}>
              {tag.progress ?? 0} / {tag.target}
            </div>
          </div>
        ) : null}
      </div>

      {editable && tag.unlocked ? (
        <>
          {equipped ? (
            <SheetItem icon={TagIcon} label="Remove from profile" onClick={() => onUnequip?.()} />
          ) : (
            <SheetItem
              icon={CheckIcon}
              label={canEquipMore ? "Equip on profile" : "3 tags equipped — remove one first"}
              disabled={!canEquipMore}
              onClick={() => onEquip?.()}
            />
          )}
        </>
      ) : null}
    </Sheet>
  );
}
