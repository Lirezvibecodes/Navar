import { useState } from "react";
import * as api from "../api";
import type { ListeningStatsPage } from "../types";
import { drawStatsOverviewCard, drawStatsTopArtistsCard, drawStatsTopTrackCard } from "../lib/storyCard";
import { saveOrShareBlob, shareToStory } from "../telegram";
import { useToast } from "../context/ToastContext";
import { Sheet, SheetItem } from "./ui";
import { ImageIcon } from "../icons";

/**
 * The Listening Stats page's share flow: three 9:16 templates built on the
 * same card infrastructure as Share to Story
 * (`StoryOutputSheet`/`storyCard.ts`), offered from the page's own share
 * button rather than from a lyric pick.
 */
export function StatsOutputSheet({
  data,
  profileUserId,
  open,
  onClose,
}: {
  data: ListeningStatsPage | null;
  profileUserId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { toast, errorToast } = useToast();
  const [busy, setBusy] = useState(false);

  const share = async (
    render: (data: ListeningStatsPage, profileUserId: number) => Promise<Blob>,
    filename: string
  ) => {
    if (!data) return;
    setBusy(true);
    try {
      const blob = await render(data, profileUserId);
      const { url } = await api.uploadStoryCard(blob);
      if (!shareToStory(url)) {
        const result = await saveOrShareBlob(blob, filename);
        if (result === "saved") toast("Saved — story sharing needs a newer Telegram");
      }
      onClose();
    } catch (err) {
      errorToast(err, "Could not build that card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Share your stats">
      <SheetItem
        icon={ImageIcon}
        label="Overview"
        disabled={busy}
        onClick={() => void share(drawStatsOverviewCard, "navaar-stats-overview.jpg")}
      />
      <SheetItem
        icon={ImageIcon}
        label="Top track"
        disabled={busy}
        onClick={() => void share(drawStatsTopTrackCard, "navaar-stats-top-track.jpg")}
      />
      <SheetItem
        icon={ImageIcon}
        label="Top artists"
        disabled={busy}
        onClick={() => void share(drawStatsTopArtistsCard, "navaar-stats-top-artists.jpg")}
      />
    </Sheet>
  );
}
