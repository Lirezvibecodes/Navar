/*
 * Navaar's service worker: keeps the app itself on the phone, so it still
 * opens when the server is asleep or out of reach.
 *
 * Where it runs: Android's WebView and desktop browsers. Telegram's in-app
 * browser on iOS does not offer service workers at all, so there the app
 * still needs the server to load, and only the saved library and songs (see
 * lib/offlineSnapshot.ts and lib/audioCache.ts) help.
 *
 * What it handles, and nothing else:
 *   - The app page at "/": from the network, but if the network has not
 *     answered in a few seconds (a sleeping Render dyno takes about thirty)
 *     or fails, the last copy that did load.
 *   - /assets/*: Vite names these by content hash, so a copy is good forever.
 *   - Fonts, the favicon and Telegram's SDK: the saved copy at once, refreshed
 *     in the background.
 *
 * The API, the audio and the share pages are never touched. The API has its
 * own offline fallback in the app, and a stale answer from here would be
 * indistinguishable from a real one.
 */

const SHELL_CACHE = "navaar-shell-v1";
const PAGE_TIMEOUT_MS = 4000;
const STATIC_FILES = /^\/(fonts\/.+|favicon\.svg|telegram-web-app\.js)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const page = await fetch("/", { cache: "no-cache" });
        if (page.ok) {
          await cache.put("/", page.clone());
          await cacheAssetsOf(cache, await page.text());
        }
      } catch {
        // Installing offline: the first successful load fills the cache.
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("navaar-shell-") && name !== SHELL_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(appPage(event));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  } else if (STATIC_FILES.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

async function appPage(event) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(event.request).then(async (res) => {
    if (res.ok) {
      await cache.put("/", res.clone());
      event.waitUntil(res.clone().text().then((html) => pruneAndFill(cache, html)));
    }
    return res;
  });

  const saved = await cache.match("/");
  if (!saved) return network;

  // Whichever comes first: a fresh page, or the timeout that gives up on it
  // for this open. The network answer still lands in the cache for next time.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(saved), PAGE_TIMEOUT_MS));
  return Promise.race([network.catch(() => saved), timeout]);
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(async (res) => {
      if (res.ok) await cache.put(event.request, res.clone());
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return refresh;
}

function assetsIn(html) {
  return [...new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? [])];
}

async function cacheAssetsOf(cache, html) {
  await Promise.all(
    assetsIn(html).map(async (path) => {
      if (await cache.match(path)) return;
      try {
        const res = await fetch(path);
        if (res.ok) await cache.put(path, res);
      } catch {
        // Picked up on first use instead.
      }
    })
  );
}

/**
 * After a deploy the page names new bundles. Fetch those now, so the next
 * offline open has them, and drop the ones nothing names any more so the cache
 * does not grow by a bundle per deploy.
 */
async function pruneAndFill(cache, html) {
  const current = new Set(assetsIn(html));
  if (current.size === 0) return;
  await cacheAssetsOf(cache, html);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/assets/") && !current.has(path)) await cache.delete(request);
  }
}
