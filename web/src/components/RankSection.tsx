import * as api from "../api";
import { CollectionArt } from "./PixelArt";
import { Counted, Empty, EYEBROW } from "./ui";
import { StarIcon } from "../icons";

/**
 * One ranked list of tracks or artists, each with a play count — shared by
 * `ProfileView`'s lifetime `ListenSheet` and `ListeningStatsView`'s top
 * tracks/artists sections, since both are the exact same row shape: a rank
 * number, cover art (or a star when there is none), a title/subtitle pair,
 * and a play count.
 */
export function RankSection<T extends { plays: number }>({
  label,
  items,
  profileUserId,
  renderTitle,
  renderSubtitle,
  coverOf,
}: {
  label: string;
  items: T[];
  profileUserId: number;
  renderTitle: (item: T) => string;
  renderSubtitle: (item: T) => string | null;
  coverOf: (item: T) => string | null;
}) {
  return (
    <div>
      <span style={{ ...EYEBROW, fontSize: 10 }}>{label}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {items.length === 0 ? (
          <Empty title="Nothing recent" body="Keep listening and this will fill in." />
        ) : (
          items.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                className="nav-numeral"
                style={{ flex: "none", width: 14, fontSize: 13, textAlign: "center", color: "var(--color-nav-muted)" }}
              >
                {i + 1}
              </span>
              {coverOf(item) ? (
                <CollectionArt
                  name={renderTitle(item)}
                  coverTrackId={coverOf(item)!}
                  src={api.trackCoverUrl(coverOf(item)!, profileUserId)}
                  size={38}
                  radius={7}
                />
              ) : (
                <span
                  style={{
                    display: "flex",
                    flex: "none",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 38,
                    height: 38,
                    borderRadius: 7,
                    background: "rgba(255,255,255,.08)",
                  }}
                >
                  <StarIcon size={14} style={{ color: "var(--color-nav-muted)" }} />
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nav-clip" style={{ fontSize: 13, fontWeight: 600 }}>
                  {renderTitle(item)}
                </div>
                {renderSubtitle(item) ? (
                  <div className="nav-clip" style={{ fontSize: 11, color: "var(--color-nav-muted)", marginTop: 1 }}>
                    {renderSubtitle(item)}
                  </div>
                ) : null}
              </div>
              <span style={{ flex: "none", fontSize: 11, color: "var(--color-nav-muted)" }}>
                <Counted count={item.plays} one="play" many="plays" />
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
