import { Router } from "express";
import { getTrackShareCover, getTrackShareForPage } from "../repo";
import { trackShareLink } from "../bot-identity";
import { serveCover } from "./covers";
import { rateLimit } from "./shared";
import { asyncHandler } from "../asyncHandler";

/**
 * The unauthenticated surfaces a share reaches outside Telegram entirely — no
 * session, no SPA. The track-share page is server-rendered HTML for a chat
 * client or browser to draw a card and a way in; the story-card route is
 * plainer still, just handing a rendered story image back by the Telegram
 * file_id that already is its whole credential (see /me/story-card). Both
 * share shared.ts's rate limiter rather than keeping their own bucket map,
 * and the track-share page resolves token and track together in one join
 * (getTrackShareForPage), never a bare id.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function trackShareRouter(): Router {
  const router = Router();

  router.use(rateLimit);

  router.get(
    "/:token",
    asyncHandler(async (req, res) => {
      const share = await getTrackShareForPage(req.params.token);
      if (!share) {
        res.status(404).type("text/plain").send("This link is not live");
        return;
      }

      const title = escapeHtml(share.title ?? "Untitled");
      const subtitle = escapeHtml(
        [share.artist, share.album].filter(Boolean).join(" — ") || "A track on Navaar"
      );
      const description = escapeHtml(
        share.sender_name ? `Sent by @${share.sender_name} on Navaar` : "Shared on Navaar"
      );
      const image = share.has_cover
        ? `${req.protocol}://${req.get("host")}/s/track/${req.params.token}/cover`
        : null;
      const openLink = trackShareLink(req.params.token);

      res.type("html").send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Navaar</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${subtitle} — ${description}">
${image ? `<meta property="og:image" content="${image}">` : ""}
<style>
  body { font-family: system-ui, sans-serif; background: #0b0c0e; color: #f5f5f5;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { text-align: center; padding: 32px; max-width: 360px; }
  img { width: 200px; height: 200px; border-radius: 12px; object-fit: cover; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { font-size: 14px; color: #a0a0a0; margin: 0 0 24px; }
  a.open { display: inline-block; background: #b6ff3c; color: #0b0c0e; font-weight: 600;
           text-decoration: none; padding: 12px 28px; border-radius: 999px; }
</style>
</head>
<body>
  <div class="card">
    ${image ? `<img src="${image}" alt="">` : ""}
    <h1>${title}</h1>
    <p>${subtitle}</p>
    ${openLink ? `<a class="open" href="${openLink}">Open in Navaar</a>` : ""}
  </div>
</body>
</html>`);
    })
  );

  router.get(
    "/:token/cover",
    asyncHandler(async (req, res) => {
      await serveCover(await getTrackShareCover(req.params.token), req, res);
    })
  );

  return router;
}

/** No database row behind this: the file_id posted by /me/story-card is the credential. */
export function storyShareRouter(): Router {
  const router = Router();
  router.use(rateLimit);
  router.get(
    "/:fileId",
    asyncHandler(async (req, res) => {
      await serveCover(
        { kind: "telegram", fileId: decodeURIComponent(req.params.fileId) },
        req,
        res
      );
    })
  );
  return router;
}
