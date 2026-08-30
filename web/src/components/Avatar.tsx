import { useState } from "react";
import { avatarUrl } from "../api";

/**
 * A person.
 *
 * Plenty of people hide their Telegram photo, and the avatar route returns a
 * clean 404 for them, so the initial-and-tint fallback below is an ordinary
 * state rather than an error path. The tint is periwinkle-family throughout:
 * in this palette a face is always a social colour, never lime.
 */

const TINTS = ["#89AEFF", "#BCE4FE", "#A9B6FF", "#7FC8F8"];

function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length];
}

interface AvatarProps {
  userId: string | number;
  username?: string | null;
  hasAvatar?: boolean;
  size: number;
  /** The lime ring that marks somebody who is listening right now. */
  ring?: boolean;
  className?: string;
  /** Bumped after this session uploads a new picture, so the browser does not
   *  keep serving the old bytes for the rest of it from its own cache. */
  bust?: number;
}

export function Avatar({
  userId,
  username,
  hasAvatar = true,
  size,
  ring,
  className,
  bust,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const seed = String(userId);
  const initial = (username?.trim()?.[0] ?? "?").toUpperCase();
  const showImage = hasAvatar && !failed;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        overflow: "hidden",
        background: showImage ? "#141414" : tintFor(seed),
        border: ring ? "1.5px solid var(--color-nav-action)" : undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#0A0A0A",
        fontWeight: 600,
        fontSize: Math.max(8, Math.round(size * 0.42)),
        lineHeight: 1,
      }}
    >
      {showImage ? (
        <img
          src={avatarUrl(userId, bust)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        initial
      )}
    </div>
  );
}
