# Navaar — Mini App frontend

The React client that runs inside Telegram. It is not deployed on its own: the
server builds this package and serves `dist/` from its own origin, so the Mini
App only ever depends on one domain (see the root `README.md`).

```bash
npm install
npm run dev        # Vite on http://localhost:5173
npm run build      # tsc -b && vite build
npm run lint       # oxlint
```

`npm run predev` / `npm run prebuild` copy Telegram's Web App SDK out of
`node_modules` into `public/`, because loading it from `telegram.org` fails on
some networks. The copy is gitignored.

Outside a real Telegram client `window.Telegram.WebApp` does not exist, so
`initData` is empty and authentication is skipped. That is enough for layout
work; for anything touching real data, point the Mini App URL at a tunnel.

## Layout

```
src/
  api.ts          every call to the server
  telegram.ts     the Telegram WebApp surface this app relies on
  view.ts         the view union — navigation is state, not a router
  design/         tokens, icons, and the primitives the wireframes define
  components/     screens and shared UI
  context/        player and app-level providers
```
