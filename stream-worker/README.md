# navaar-stream

A Cloudflare Worker that streams Navaar's audio, so plays don't count against
the server's bandwidth. The server still decides who may play what; it answers
the player with a redirect to a signed, expiring link here, and the Worker
fetches the file from Telegram and streams it (with seeking) straight to the
phone.

It runs on Cloudflare's free Workers plan at
`https://navaar-stream.<your-subdomain>.workers.dev`.

## Setup

1. Deploy `worker.js` as a Worker named `navaar-stream`, either by pasting it
   into the dashboard editor or with `npx wrangler deploy` from this folder.
2. Add two secrets to the Worker (**Settings → Variables and Secrets**):
   - `BOT_TOKEN`: the same bot token the server uses.
   - `STREAM_SIGNING_SECRET`: any long random string, e.g.
     `openssl rand -hex 32`.
3. On the server, set `STREAM_BASE_URL` to the Worker's address (no trailing
   slash) and `STREAM_SIGNING_SECRET` to the same value as the Worker's.

With either server variable missing, the server streams the audio itself as it
always did, so the Worker can be set up or removed without breaking playback.

## When you change the bot token

Update `BOT_TOKEN` in both places: the server and this Worker.

## Checking it

A request with a bad signature should get `403 Bad signature`:

```sh
curl -i "https://navaar-stream.<your-subdomain>.workers.dev/a/x?exp=9999999999&type=audio/mpeg&sig=bad"
```
