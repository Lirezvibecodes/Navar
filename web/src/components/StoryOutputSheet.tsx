import { useState } from "react";
import * as api from "../api";
import type { Track } from "../types";
import { renderStoryCard } from "../lib/storyCard";
import { shareToStory } from "../telegram";
import { useToast } from "../context/ToastContext";
import { Sheet, SheetItem } from "./ui";
import { ImageIcon } from "../icons";

export interface StoryPick {
  track: Track;
  lines: { text: string; at: number | null }[];
}

/**
 * The second step of Share to Story, after a lyric passage (or "Skip") has
 * been picked: today's card, as a stable image.
 *
 * A ten-second karaoke video used to sit alongside this as a second output —
 * pulled for now (`storyVideo.ts` still has the rendering code, just nothing
 * wired to it), leaving the image as the only output.
 */
export function StoryOutputSheet({
  pick,
  onClose,
}: {
  pick: StoryPick | null;
  onClose: () => void;
}) {
  const { toast, errorToast } = useToast();
  const [busy, setBusy] = useState(false);

  const shareImage = async (p: StoryPick) => {
    setBusy(true);
    try {
      const blob = await renderStoryCard(
        p.track,
        p.lines.map((l) => l.text)
      );
      const { url } = await api.uploadStoryCard(blob);
      if (!shareToStory(url)) {
        toast("Story sharing needs a newer Telegram");
      }
      onClose();
    } catch (err) {
      errorToast(err, "Could not build that story");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={pick != null} onClose={onClose} title="Share to Story">
      <SheetItem
        icon={ImageIcon}
        label="Stable image"
        disabled={busy}
        onClick={() => {
          if (pick) void shareImage(pick);
        }}
      />
    </Sheet>
  );
}
