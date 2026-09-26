// Renders scene.html to an MP4, one frame at a time.
//
//   node render.mjs --out navaar.mp4 [--audio music.m4a] [--blur 4] [--from 0 --to 19.3]
//
// The scene is a pure function of time (window.renderAt), so each frame is set
// explicitly and screenshotted rather than recorded in real time; a slow
// machine gives the same video, just later.
//
// --blur N renders N sub-frames per output frame and averages them, which is
// what gives the fast moves their motion blur. 1 is fine for a preview.
//
// --audio muxes a soundtrack in and trims the video to it. The music is not
// part of this repo: pass the file you are licensed to use.
//
// Needs Playwright (with a Chromium it can find) and ffmpeg on PATH, or
// FFMPEG=/path/to/ffmpeg.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") ? true : (all[i + 1] ?? true)]);
    return acc;
  }, []),
);

const FPS = 30;
const blur = Math.max(1, parseInt(args.blur ?? "1", 10));
const out = path.resolve(args.out ?? "navaar.mp4");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Fall back to a global install.
    const { execSync } = await import("node:child_process");
    const root = execSync("npm root -g").toString().trim();
    return createRequire(path.join(root, "noop.js"))("playwright");
  }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ["--allow-file-access-from-files", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "scene.html")).href);
await page.waitForFunction(() => window.sceneReady === true);

const duration = await page.evaluate(() => window.DURATION);
const from = parseFloat(args.from ?? "0");
const to = Math.min(duration, parseFloat(args.to ?? String(duration)));
const frames = Math.round((to - from) * FPS);

const vf = blur > 1 ? ["-vf", `tmix=frames=${blur},select='not(mod(n\\,${blur}))',setpts=N/${FPS}/TB`] : [];
const ff = spawn(
  ffmpeg,
  [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS * blur), "-i", "-",
    ...(args.audio ? ["-ss", String(from), "-i", path.resolve(args.audio)] : []),
    ...vf,
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    ...(args.audio ? ["-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
    out,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);

const started = Date.now();
for (let f = 0; f < frames; f++) {
  for (let s = 0; s < blur; s++) {
    // Sub-frames spread over half a frame centred on the frame time, like a
    // 180-degree shutter.
    const t = from + (f + (blur > 1 ? (s / (blur - 1) - 0.5) * 0.5 : 0)) / FPS;
    await page.evaluate((tt) => window.renderAt(tt), t);
    const png = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  if (f % 30 === 0) process.stdout.write(`\rframe ${f}/${frames}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise((resolve, reject) => ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
await browser.close();
console.log(`\nwrote ${out}`);
