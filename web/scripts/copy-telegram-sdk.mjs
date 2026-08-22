// Copies Telegram's official Mini App SDK out of node_modules and into public/
// so Vite serves it from our own origin.
//
// It cannot be loaded from telegram.org: that domain is blocked on some
// networks where the Mini App itself still loads fine, and because the tag is
// render-blocking the WebView stalls on it and reports "load failed".
//
// It also cannot simply be imported from the bundle. @twa-dev/sdk maps its
// "import" condition to dist/index.js, but that file is CommonJS, so Vite
// resolves the default export to an interop wrapper instead of the WebApp
// object. Loading the script as a plain classic script sidesteps the bundler
// entirely and is how Telegram documents it anyway.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(webRoot, "node_modules/@twa-dev/sdk/dist/telegram-web-apps.js");
const target = join(webRoot, "public/telegram-web-app.js");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[telegram-sdk] ${source} -> ${target}`);
