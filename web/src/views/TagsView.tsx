import { useMemo, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { TagCard, TagPlaque } from "../components/TagCard";
import { TagDetailSheet, detailFromState } from "../components/TagDetailSheet";
import type { TagDetailInfo } from "../components/TagDetailSheet";
import { Chip, ChipRow, Empty, EYEBROW, Num, Screen, Skeleton } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { cacheKey, ttl, useCached } from "../lib/cache";
import {
  MAX_EQUIPPED_TAGS,
  TAG_CATEGORY_LABEL,
  TAG_CATEGORY_ORDER,
} from "../lib/tagTiers";
import { haptic } from "../telegram";
import type { TagCategory, TagState } from "../types";

/**
 * Tags — the collectible layer, reached only by pushing from Profile.
 *
 * Everything on this screen comes from one call (`GET /api/tags`), the same
 * one-round-trip discipline every other screen in the app follows. Equipping
 * and unequipping write through that same cache entry rather than mutating
 * local state and hoping it matches what the server persisted — `setTags`
 * below always takes the server's own answer, which is also what confirms an
 * equip actually landed instead of assuming it did.
 */

type Filter = "all" | TagCategory;

/**
 * Where a tag sits in the grid (spec section 13). Unlocked leads, newest
 * unlock first. Locked-with-progress comes next, closest to done first — the
 * ones worth chasing belong near the top, not buried behind tags nobody has
 * started. Locked-with-no-progress-bar follows, and a locked secret tag is
 * always last regardless of anything else about it: the mystery row never
 * elbows in front of a tag a person can actually see themselves working
 * toward.
 */
function rank(tag: TagState): [number, number] {
  if (tag.unlocked) return [0, tag.unlocked_at ? -Date.parse(tag.unlocked_at) : 0];
  if (tag.secret) return [3, 0];
  if (tag.target) return [1, -((tag.progress ?? 0) / tag.target)];
  return [2, 0];
}

export function TagsView({ nav: _nav }: { nav: Navigation }) {
  const { errorToast } = useToast();
  const { data: tags, loading, set: setTags } = useCached(cacheKey.tags, api.getTags, ttl.tags);
  const [filter, setFilter] = useState<Filter>("all");
  const [openTag, setOpenTag] = useState<TagDetailInfo | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const all = tags ?? [];
  const unlockedCount = all.filter((t) => t.unlocked).length;
  const equipped = all.filter((t) => t.equipped);

  const shown = useMemo(() => {
    const filtered = filter === "all" ? all : all.filter((t) => t.category === filter);
    return [...filtered].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1];
    });
  }, [all, filter]);

  const openSheet = (tag: TagState) => {
    setOpenTag(detailFromState(tag));
    setSheetOpen(true);
  };

  // Both equip and unequip are the same call with a different id set — the
  // server is what actually enforces the 3-tag cap and the unlocked check, so
  // this always takes its answer rather than predicting one.
  const setEquipped = async (ids: string[], failure: string) => {
    try {
      setTags(await api.setEquippedTags(ids));
      haptic.select();
    } catch (err) {
      errorToast(err, failure);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Skeleton rows={5} />
      </Screen>
    );
  }

  return (
    <Screen scrollKey="tags">
      <div
        className="nav-rise"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 2 }}
      >
        <div>
          <span style={EYEBROW}>Collected</span>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em", marginTop: 3 }}>
            <Num>{unlockedCount}</Num> / <Num>{all.length}</Num>
          </div>
        </div>
        {all.length > 0 ? (
          <div style={{ width: 100 }}>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.round((unlockedCount / all.length) * 100)}%`,
                  borderRadius: 3,
                  background: "var(--color-nav-action)",
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {equipped.length > 0 ? (
        <div className="nav-rise" style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {equipped.map((tag) => (
            <TagPlaque key={tag.id} name={tag.name} tier={tag.tier} onOpen={() => openSheet(tag)} />
          ))}
        </div>
      ) : null}

      <div className="nav-rise" style={{ marginTop: 16 }}>
        <ChipRow>
          <Chip label="All" active={filter === "all"} onClick={() => setFilter("all")} />
          {TAG_CATEGORY_ORDER.map((category) => (
            <Chip
              key={category}
              label={TAG_CATEGORY_LABEL[category]}
              active={filter === category}
              onClick={() => setFilter(category)}
            />
          ))}
        </ChipRow>
      </div>

      {unlockedCount === 0 && filter === "all" ? (
        <Empty
          title="Nothing unlocked yet"
          body="Listen, save tracks, build playlists and connect with friends — tags unlock quietly in the background as you go."
        />
      ) : shown.length === 0 ? (
        <Empty title="Nothing here" body="No tags in this category yet." />
      ) : (
        <div
          className="nav-rise"
          style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 14 }}
        >
          {shown.map((tag) => (
            <TagCard key={tag.id} tag={tag} onOpen={() => openSheet(tag)} />
          ))}
        </div>
      )}

      <TagDetailSheet
        tag={openTag}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editable
        equipped={openTag ? equipped.some((t) => t.id === openTag.id) : false}
        canEquipMore={equipped.length < MAX_EQUIPPED_TAGS}
        onEquip={() => {
          if (!openTag) return;
          void setEquipped([...equipped.map((t) => t.id), openTag.id], "Could not equip that");
        }}
        onUnequip={() => {
          if (!openTag) return;
          void setEquipped(
            equipped.filter((t) => t.id !== openTag.id).map((t) => t.id),
            "Could not remove that"
          );
        }}
      />
    </Screen>
  );
}
