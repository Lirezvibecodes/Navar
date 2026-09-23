import { useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { CollectionArt } from "../components/PixelArt";
import { RankSection } from "../components/RankSection";
import { StatsOutputSheet } from "../components/StatsOutputSheet";
import {
  ActionButton,
  Chip,
  ChipRow,
  Counted,
  Empty,
  EYEBROW,
  Num,
  Screen,
  SectionHeader,
  Skeleton,
} from "../components/ui";
import type { IconProps } from "../icons";
import { BoltIcon, ClockIcon, RepeatIcon, ShareIcon, SparklesIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { cacheKey, ttl, useCached } from "../lib/cache";
import { formatListened, pluralise } from "../lib/format";
import { haptic } from "../telegram";
import type { ListeningStatsPage, StatsRange } from "../types";

/**
 * The full first-person listening-stats page, reached only from your own
 * profile's listen chip (a friend's profile keeps the old lifetime sheet).
 *
 * One continuous scroll, not a slideshow: the period selector stays pinned at
 * the top and everything below it re-renders in place when the range
 * changes, so switching periods never feels like leaving and re-entering a
 * "Wrapped"-style recap.
 */

const RANGES: { value: StatsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All Time" },
];

const RANGE_EYEBROW: Record<StatsRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "3m": "Last 3 months",
  "1y": "Last year",
  all: "All time",
};

const RANGE_EMPTY_BODY: Record<StatsRange, string> = {
  today: "Nothing played yet today.",
  "7d": "Nothing played in the last 7 days.",
  "30d": "Nothing played in the last 30 days.",
  "3m": "Nothing played in the last 3 months.",
  "1y": "Nothing played in the last year.",
  all: "Nothing played yet — start listening and this page fills in.",
};

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export function ListeningStatsView({ nav: _nav }: { nav: Navigation }) {
  const { me } = useLibrary();
  const [range, setRange] = useState<StatsRange>("30d");
  const [shareOpen, setShareOpen] = useState(false);

  const {
    data,
    loading,
    error,
    refresh,
  } = useCached(cacheKey.listeningStats(range), () => api.getListeningStatsPage(range), ttl.listeningStats);

  return (
    <Screen scrollKey="stats">
      <div className="nav-rise" style={{ paddingTop: 2 }}>
        <ChipRow>
          {RANGES.map((r) => (
            <Chip
              key={r.value}
              label={r.label}
              active={range === r.value}
              onClick={() => {
                haptic.select();
                setRange(r.value);
              }}
            />
          ))}
        </ChipRow>
      </div>

      {error && !data ? (
        <Empty
          title="Stats did not load"
          body="Nothing is lost. This was the connection, most likely."
          action="Try again"
          onAction={refresh}
        />
      ) : !data ? (
        <div style={{ marginTop: 22 }}>
          <Skeleton />
        </div>
      ) : data.totalPlays === 0 ? (
        <Empty title="Nothing here yet" body={RANGE_EMPTY_BODY[range]} />
      ) : me ? (
        <StatsBody data={data} me={me.id} onShare={() => setShareOpen(true)} />
      ) : (
        <div style={{ marginTop: 22 }}>
          <Skeleton />
        </div>
      )}

      {loading && data ? null : null}

      <StatsOutputSheet
        data={data ?? null}
        profileUserId={me?.id ?? 0}
        open={shareOpen && data != null}
        onClose={() => setShareOpen(false)}
      />
    </Screen>
  );
}

function StatsBody({
  data,
  me,
  onShare,
}: {
  data: ListeningStatsPage;
  me: number;
  onShare: () => void;
}) {
  const delta = data.previous ? deltaPct(data.totalListenedSeconds, data.previous.totalListenedSeconds) : null;
  const showLongestSession = data.longestSessionMinutes != null;
  const showStreak = data.currentStreakDays >= 2;

  return (
    <>
      <div className="nav-rise" style={{ textAlign: "center", padding: "22px 0 4px" }}>
        <span style={EYEBROW}>{RANGE_EYEBROW[data.range]}</span>
        <div
          className="nav-numeral"
          style={{
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1,
            marginTop: 8,
            color: "var(--color-nav-action)",
          }}
        >
          {formatListened(data.totalListenedSeconds)}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-nav-muted)", marginTop: 6 }}>
          <Counted count={data.totalPlays} one="play" many="plays" />
          {delta != null ? (
            <span style={{ marginLeft: 6, color: delta >= 0 ? "var(--color-nav-action)" : "var(--color-nav-muted)" }}>
              {delta >= 0 ? "+" : ""}
              {delta}% vs. previous
            </span>
          ) : null}
        </div>
      </div>

      <ActivityChart activity={data.activity} />

      {data.topTracks.length > 0 || data.topArtists.length > 0 ? (
        <div className="nav-rise" style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 22 }}>
          <RankSection
            label="Top tracks"
            items={data.topTracks}
            profileUserId={me}
            renderTitle={(t) => t.title ?? "Untitled"}
            renderSubtitle={(t) => t.artist}
            coverOf={(t) => t.cover_track_id}
          />
          <RankSection
            label="Top artists"
            items={data.topArtists}
            profileUserId={me}
            renderTitle={(a) => a.name}
            renderSubtitle={() => null}
            coverOf={(a) => a.cover_track_id}
          />
        </div>
      ) : null}

      <TimeOfDay values={data.timeOfDay} />
      <DayOfWeek values={data.dayOfWeek} />

      <div className="nav-rise" style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <StatTile icon={RepeatIcon} label="Repeat rate" value={`${Math.round(data.repeatRate * 100)}%`} />
        <StatTile icon={SparklesIcon} label="Discovered" value={String(data.discoveryCount)} />
      </div>

      <LibraryCoverage pct={data.libraryCoveragePct} />

      {data.onRepeat ? <OnRepeatCard track={data.onRepeat} profileUserId={me} /> : null}

      {showLongestSession || showStreak ? (
        <div className="nav-rise" style={{ display: "flex", gap: 10, marginTop: 22 }}>
          {showLongestSession ? (
            <StatTile icon={ClockIcon} label="Longest session" value={`${data.longestSessionMinutes}m`} />
          ) : null}
          {showStreak ? (
            <StatTile icon={BoltIcon} label="Current streak" value={pluralise(data.currentStreakDays, "day")} />
          ) : null}
        </div>
      ) : null}

      <div className="nav-rise" style={{ marginTop: 26, marginBottom: 8 }}>
        <ActionButton
          icon={ShareIcon}
          onClick={() => {
            haptic.tap();
            onShare();
          }}
        >
          Share your stats
        </ActionButton>
      </div>
    </>
  );
}

function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function ActivityChart({ activity }: { activity: ListeningStatsPage["activity"] }) {
  if (activity.length === 0) return null;
  const max = Math.max(1, ...activity.map((b) => b.seconds));
  const w = 100 / activity.length;
  return (
    <div className="nav-rise" style={{ marginTop: 10 }}>
      <SectionHeader title="Activity" eyebrow spaceAbove={22} />
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 84, display: "block", marginTop: 8 }}
      >
        {activity.map((b, i) => {
          const h = (b.seconds / max) * 38;
          return (
            <rect
              key={i}
              x={i * w + w * 0.15}
              y={40 - h}
              width={w * 0.7}
              height={Math.max(h, 0.6)}
              rx={0.6}
              fill="var(--color-nav-action)"
              opacity={b.seconds > 0 ? 0.9 : 0.18}
            />
          );
        })}
      </svg>
    </div>
  );
}

function TimeOfDay({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const rInner = 34;
  const rOuter = 70;
  return (
    <div className="nav-rise" style={{ marginTop: 10 }}>
      <SectionHeader title="Time of day" eyebrow spaceAbove={22} />
      <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={1} />
          {values.map((v, hour) => {
            const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
            const len = rInner + (v / max) * (rOuter - rInner);
            const x1 = cx + Math.cos(angle) * rInner;
            const y1 = cy + Math.sin(angle) * rInner;
            const x2 = cx + Math.cos(angle) * len;
            const y2 = cy + Math.sin(angle) * len;
            return (
              <line
                key={hour}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--color-nav-action)"
                strokeWidth={2.4}
                strokeLinecap="round"
                opacity={v > 0 ? 0.85 : 0.15}
              />
            );
          })}
        </svg>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--color-nav-muted)",
          padding: "2px 30px 0",
        }}
      >
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
      </div>
    </div>
  );
}

function DayOfWeek({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="nav-rise" style={{ marginTop: 10 }}>
      <SectionHeader title="Day of week" eyebrow spaceAbove={22} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 64, marginTop: 10 }}>
        {values.map((v, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: "100%",
                maxWidth: 22,
                height: Math.max(4, (v / max) * 52),
                borderRadius: 4,
                background: "var(--color-nav-action)",
                opacity: v > 0 ? 0.85 : 0.15,
              }}
            />
            <span style={{ fontSize: 10, color: "var(--color-nav-muted)" }}>{DAY_LABELS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: (props: IconProps) => React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div style={{ flex: 1, background: "rgba(255,255,255,.05)", borderRadius: 14, padding: 14 }}>
      <Icon size={16} style={{ color: "var(--color-nav-muted)" }} />
      <div className="nav-numeral" style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-nav-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function LibraryCoverage({ pct }: { pct: number }) {
  const percent = Math.round(pct * 100);
  return (
    <div className="nav-rise" style={{ marginTop: 10 }}>
      <SectionHeader title="Library coverage" eyebrow spaceAbove={22} />
      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: "var(--color-nav-muted)" }}>Of your library played</span>
          <span>
            <Num>{percent}</Num>%
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, percent)}%`,
              borderRadius: 3,
              background: "var(--color-nav-action)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function OnRepeatCard({
  track,
  profileUserId,
}: {
  track: NonNullable<ListeningStatsPage["onRepeat"]>;
  profileUserId: number;
}) {
  return (
    <div className="nav-rise" style={{ marginTop: 22 }}>
      <span style={{ ...EYEBROW, fontSize: 10 }}>On repeat</span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 10,
          background: "rgba(255,255,255,.05)",
          borderRadius: 14,
          padding: 12,
        }}
      >
        <CollectionArt
          name={track.title ?? "Untitled"}
          coverTrackId={track.cover_track_id}
          src={track.cover_track_id ? api.trackCoverUrl(track.cover_track_id, profileUserId) : null}
          size={52}
          radius={9}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nav-clip" style={{ fontSize: 14, fontWeight: 700 }}>
            {track.title ?? "Untitled"}
          </div>
          <div className="nav-clip" style={{ fontSize: 12, color: "var(--color-nav-muted)", marginTop: 2 }}>
            {track.artist ?? "Unknown artist"}
          </div>
        </div>
        <span style={{ flex: "none", fontSize: 11, color: "var(--color-nav-muted)" }}>
          <Counted count={track.plays} one="play" many="plays" />
        </span>
      </div>
    </div>
  );
}
