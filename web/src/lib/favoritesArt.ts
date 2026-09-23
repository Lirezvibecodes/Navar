import { useEffect, useState } from "react";
import * as api from "../api";
import { drawPixelatedWash } from "./pixelWash";
import { loadImage } from "./storyCard";

/**
 * The Favourites playlist's own cover: a square, darkened pixel wash of the
 * signed-in user's avatar with the app's heart glyph laid over the middle, so
 * the one playlist that isn't really a playlist still reads as unmistakably
 * theirs. Lives here rather than in pixelWash.ts because nothing else needs a
 * heart baked into the wash, and rather than in ProfileView.tsx because that
 * file's own pixelated art is a track cover, not an avatar. Shared between the
 * Library grid's Favourites tile and FavoritesView's own header, which both
 * need the identical image.
 */
export function useFavoritesArt(meId: number | null): string | null {
  const [art, setArt] = useState<string | null>(null);
  useEffect(() => {
    if (meId == null) {
      setArt(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [avatar, heart] = await Promise.all([
        loadImage(api.avatarUrl(meId)),
        loadImage(heartDataUrl()),
      ]);
      if (cancelled || !avatar) return;
      const size = 224;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawPixelatedWash(ctx, avatar, size, size, 18, 3);
      ctx.fillStyle = "rgba(0,0,0,.4)";
      ctx.fillRect(0, 0, size, size);
      if (heart) {
        const h = size * 0.42;
        ctx.drawImage(heart, (size - h) / 2, (size - h) / 2, h, h);
      }
      if (!cancelled) setArt(canvas.toDataURL("image/jpeg", 0.85));
    })();
    return () => {
      cancelled = true;
    };
  }, [meId]);
  return art;
}

/**
 * The pixel-art heart glyph as its own tiny image, tinted to the live accent
 * so it composites onto a canvas the same colour a favourited track's heart
 * already uses everywhere else. The polygon is HeartIcon's own from
 * icons.tsx, copied rather than imported — a React icon component has no
 * markup to hand a canvas until it is mounted, and this is the one place in
 * the app that needs the glyph as a plain image instead.
 */
function heartDataUrl(): string {
  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-nav-action")
      .trim() || "#c6f24a";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${accent}"><polygon points="23 6 23 11 22 11 22 12 21 12 21 13 20 13 20 14 19 14 19 15 18 15 18 16 17 16 17 17 16 17 16 18 15 18 15 19 14 19 14 20 13 20 13 21 11 21 11 20 10 20 10 19 9 19 9 18 8 18 8 17 7 17 7 16 6 16 6 15 5 15 5 14 4 14 4 13 3 13 3 12 2 12 2 11 1 11 1 6 2 6 2 5 3 5 3 4 4 4 4 3 10 3 10 4 11 4 11 5 13 5 13 4 14 4 14 3 20 3 20 4 21 4 21 5 22 5 22 6 23 6"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
