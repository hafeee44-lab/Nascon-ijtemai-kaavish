# CLUB|HOUSE Live: static showcase

The real app is a full stack: NestJS API, PostgreSQL, Redis Streams, MediaMTX (RTMP / HLS / WebRTC), and a React Native app. A static host such as Vercel can't run that, so this folder builds a **static showcase** of the web UI:

- `build.mjs` crawls the server-rendered `/web` pages from a running local stack. It sets `Host` to the public site, so QR codes point there. It copies the assets, adds a `/q/{code}` → page redirect for every QR in `vercel.json`, and writes everything to `dist/`.
- `demo.js` runs only in the static build. It answers the page's API calls in the browser and simulates the live layer: goals over the "SSE" stream, fan chat, QR scans, and a recorded broadcast clip instead of HLS. A **Demo build** label links back to this repo.
- `media/broadcast.mp4` is a 12 s push-in on the CC0 stadium photo (`backend/src/web/assets/img/stadium.jpg`).

## Rebuild

```bash
docker compose up -d                      # the real stack on :8080
curl -X POST localhost:8080/audit/v1/reset
node showcase/build.mjs clubhouse-live.vercel.app
```

## Deploy

Use the Vercel project `clubhouse-live` with **Root Directory** `showcase/dist`, framework **Other** and no build command. The Git branch is `portfolio-ui`.
