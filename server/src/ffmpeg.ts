import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

/**
 * Turns a handful of story-card frames into the karaoke video story.
 *
 * The client already did the interesting work — deciding which frame shows
 * which picked lyric line highlighted, and for how long. This just has to
 * hold each frame on screen for its duration and lay the track's own audio,
 * trimmed to the same window, underneath — which is exactly what ffmpeg's
 * concat demuxer plus a second input are for.
 */
export interface StoryVideoInput {
  /** One JPEG per highlight change, in order. */
  frames: Buffer[];
  /** How long each frame holds, in seconds — same length and order as `frames`. */
  durations: number[];
  /** The track's own audio, already the full file — ffmpeg does the trimming. */
  audio: Buffer;
  /** Where in `audio` the clip starts. */
  clipStart: number;
  /** How long the clip runs. */
  clipDuration: number;
}

export async function renderStoryVideo(input: StoryVideoInput): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("ffmpeg binary not available");
  if (input.frames.length !== input.durations.length) {
    throw new Error("frame/duration count mismatch");
  }

  const dir = await mkdtemp(join(tmpdir(), "navaar-story-"));
  try {
    const framePaths = await Promise.all(
      input.frames.map(async (frame, i) => {
        const path = join(dir, `frame_${i}.jpg`);
        await writeFile(path, frame);
        return path;
      })
    );

    // The concat demuxer ignores the last entry's duration, so its file is
    // listed a second time with no duration line — the standard workaround.
    const list = framePaths
      .map((path, i) => `file '${path.replace(/'/g, "'\\''")}'\nduration ${input.durations[i]}`)
      .concat(`file '${framePaths[framePaths.length - 1].replace(/'/g, "'\\''")}'`)
      .join("\n");
    const listPath = join(dir, "frames.txt");
    await writeFile(listPath, list);

    const audioPath = join(dir, "audio.tmp");
    await writeFile(audioPath, input.audio);

    const outPath = join(dir, "out.mp4");
    await run(ffmpegPath, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-ss", String(input.clipStart),
      "-t", String(input.clipDuration),
      "-i", audioPath,
      "-map", "0:v",
      "-map", "1:a",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",
      "-movflags", "+faststart",
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
