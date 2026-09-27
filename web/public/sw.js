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
 *   - Covers, playlist artwork and avatars: the saved copy first, so the
 *     library keeps its pictures offline and on a connection that hangs.
 *   - /offline-audio/<id>: a downloaded song, from the device.
 *
 * The rest of the API, the audio and the share pages are never touched. The
 * API has its own offline fallback in the app, and a stale answer from here
 * would be indistinguishable from a real one.
 */

const SHELL_CACHE = "navaar-shell-v1";
const ART_CACHE = "navaar-art-v1";
const ART_LIMIT = 600;
// Covers, playlist artwork and avatars: kept so the library still has its
// pictures offline. See artwork() below.
const ART = /^\/api\/(tracks\/[^/]+\/cover|playlists\/[^/]+\/artwork|users\/[^/]+\/avatar)$/;
const ART_TIMEOUT_MS = 10000;
// Downloaded songs, played from the device (see offlineAudio below).
const OFFLINE_AUDIO = /^\/offline-audio\/([^/]+)$/;
const PAGE_TIMEOUT_MS = 4000;
const STATIC_FILES = /^\/(fonts\/.+|icons\/.+|favicon\.svg|manifest\.webmanifest|telegram-web-app\.js)$/;

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
        const stale =
          (name.startsWith("navaar-shell-") && name !== SHELL_CACHE) ||
          (name.startsWith("navaar-art-") && name !== ART_CACHE);
        if (stale) await caches.delete(name);
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
  } else if (ART.test(url.pathname)) {
    event.respondWith(artwork(event, url));
  } else if (OFFLINE_AUDIO.test(url.pathname)) {
    const id = decodeURIComponent(OFFLINE_AUDIO.exec(url.pathname)[1]);
    event.respondWith(offlineAudio(request, id));
  }
});

/**
 * A downloaded song, answered from the device like any audio file on a
 * server, Range requests included.
 *
 * The app used to hand the audio element an object URL for the stored Blob.
 * That plays in Chromium, but Safari's media stack does not reliably play
 * Blobs that live in IndexedDB, and on iPhone downloads would not play
 * offline. Served from here, the element sees an ordinary same-origin URL
 * and asks for byte ranges the way it asks any server.
 *
 * The songs stay where the app keeps them (audioCache.ts: Cache Storage
 * "navaar-audio-files-v1", or IndexedDB "navaar-audio" for older ones); this
 * only reads them.
 */
async function offlineAudio(request, id) {
  // The installed app keeps downloads in Cache Storage (see AUDIO_FILES in
  // audioCache.ts); IndexedDB is only for songs not moved there yet.
  let blob = null;
  let type = null;
  try {
    const files = await caches.open("navaar-audio-files-v1");
    const hit = await files.match(`/offline-audio/${encodeURIComponent(id)}`);
    if (hit) {
      type = hit.headers.get("Content-Type");
      blob = await hit.blob();
    }
  } catch {
    blob = null;
  }
  if (!blob) {
    const row = await readSong(id).catch(() => null);
    if (row && row.blob instanceof Blob) {
      blob = row.blob;
      type = row.track && row.track.mime_type;
    }
  }
  if (!blob) return new Response("Not downloaded", { status: 404 });

  type = type || blob.type || "audio/mpeg";
  const size = blob.size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  if (!range) {
    return new Response(blob, {
      status: 200,
      headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
    });
  }

  let start;
  let end;
  if (range[1] === "") {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(range[2]));
    end = size - 1;
  } else {
    start = Number(range[1]);
    end = range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}

function readSong(id) {
  return new Promise((resolve, reject) => {
    // Same name, version and store as audioCache.ts, so that opening it here
    // first can never leave the app with a database missing its store.
    const open = indexedDB.open("navaar-audio", 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains("tracks")) {
        open.result.createObjectStore("tracks", { keyPath: "id" });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction("tracks").objectStore("tracks").get(id);
      get.onsuccess = () => {
        resolve(get.result || null);
        db.close();
      };
      get.onerror = () => {
        reject(get.error);
        db.close();
      };
    };
  });
}

/**
 * Covers, playlist artwork and avatars: the saved copy at once when there is
 * one, refreshed in the background; otherwise the network, given up on after
 * ART_TIMEOUT_MS. Saved-first rather than network-first because a connection
 * that hangs rather than fails would otherwise hold every picture on screen
 * hostage, downloaded songs' covers included.
 *
 * Filed under the address without the session token, which changes on every
 * sign-in, or profileOf, which only says whose page is asking: the picture is
 * the same either way, and a cover saved while downloading a song must match
 * wherever that song is shown. The oldest go past ART_LIMIT.
 */
async function artwork(event, url) {
  const key = new URL(url);
  key.searchParams.delete("token");
  key.searchParams.delete("profileOf");
  const cache = await caches.open(ART_CACHE);

  const refresh = (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ART_TIMEOUT_MS);
    try {
      const res = await fetch(event.request, { signal: abort.signal });
      if (res.ok) {
        await cache.put(key.href, res.clone());
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - ART_LIMIT))) await cache.delete(old);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  })();

  const hit = await cache.match(key.href);
  if (hit) {
    event.waitUntil(refresh.catch(() => undefined));
    return hit;
  }
  return refresh;
}

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
