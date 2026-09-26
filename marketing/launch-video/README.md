# Navaar launch spot

A 19-second, 1920×1080 motion piece: the `/playlist` command typed into
Telegram, three forwarded tracks landing, Navaar answering with the playlist,
a close-up of it starting to play, and the pixel mark building into the
wordmark.

- `scene.html` — the whole animation, as a pure function of time
  (`window.renderAt(t)`). Open it in a browser to preview it playing live.
- `render.mjs` — steps the scene frame by frame in headless Chromium and pipes
  the frames to ffmpeg.

## Rendering

```sh
cd marketing/launch-video
node render.mjs --out navaar-launch.mp4 --audio /path/to/music.m4a --blur 4
```

- `--audio` muxes the soundtrack in and trims to it. The music is **not** in
  the repo; pass the licensed file yourself. Without it you get a silent cut.
- `--blur N` averages N sub-frames per frame for motion blur. `4` for the
  final render, `1` for a quick preview.
- `--from` / `--to` render just a range, in seconds.

Needs Playwright with a Chromium it can find, and `ffmpeg` on `PATH` (or
`FFMPEG=/path/to/ffmpeg`).

## Timing

The cuts sit on the music's beat grid (a step is about 0.24s), so a different
track will need the times in `scene.html` moved to its own beats.

| Time   | Shot                                         |
| ------ | -------------------------------------------- |
| 0.00   | Cold open on the finished chat               |
| 0.77   | Composer, typing `/playlist Late Night Drive` |
| 3.30   | The chat, command sent                       |
| 4.27   | Three forwarded tracks land                  |
| 5.90   | Navaar replies with the playlist card        |
| 8.00   | Close-up on the card, play pressed           |
| 13.00  | End card: mark, wordmark, tagline            |
| 17.20  | Black                                        |

The track and artist names in the chat are made up.
