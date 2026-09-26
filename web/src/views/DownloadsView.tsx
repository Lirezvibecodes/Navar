import { useMemo } from "react";
import type { Navigation } from "../App";
import { TrackListScreen } from "../components/TrackListScreen";
import { useLibrary } from "../context/LibraryContext";
import { useAudioCacheStats, useSavedTracks } from "../lib/audioCache";
import { pluralise } from "../lib/format";
import { DownloadIcon } from "../icons";

/**
 * "On this phone": every song the installed web app has downloaded, shown as
 * a playlist. It is built from the downloads themselves rather than from the
 * library, so it is complete with no connection and includes songs that came
 * from somebody else's playlist. Where the library does hold a song, its
 * current details win over the ones saved with the download.
 */
export function DownloadsView({ nav }: { nav: Navigation }) {
  const saved = useSavedTracks();
  const { tracks } = useLibrary();
  const { bytes } = useAudioCacheStats();

  const list = useMemo(() => {
    const live = new Map(tracks.map((t) => [t.id, t]));
    return saved.map((t) => live.get(t.id) ?? t);
  }, [saved, tracks]);

  return (
    <TrackListScreen
      nav={nav}
      art={
        <span
          style={{
            width: 96,
            height: 96,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 16,
            background: "var(--color-nav-action)",
            color: "#0b0c0e",
          }}
        >
          <DownloadIcon size={40} />
        </span>
      }
      name="On this phone"
      subtitle={
        list.length === 0
          ? "Nothing downloaded yet"
          : `${pluralise(list.length, "song")} · ${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`
      }
      tracks={list}
      sourceKey="downloads"
      sourceLabel="On this phone"
      emptyTitle="Nothing downloaded yet"
      emptyBody="Tap the download button on a playlist or album, or Download in a song's menu, and it lands here."
    />
  );
}
