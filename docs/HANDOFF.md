# Session handoff: NaSCon '26 Day 2 (written 18 Oct 2026, 12:52 PKT)

Give this file to a new agent to continue. It summarises everything done so far, what is running, and what is left.

## 1. Team, event, rules

- Team **Aik kachori do Samosa**: Hafi (repo owner, Claude), Haider Imran (Codex, UI + QA harness), Afnan "afnan-nex" (mobile, Phase 5).
- Event: NaSCon '26 App Dev Competition, FAST-NUCES Islamabad. Day 2 = Phase II "Live Streaming, Dynamic QR Deep-Linking & Automated Grid QA".
- Repo: `github.com/hafeee44-lab/Nascon-ijtemai-kaavish` (public). Hafi's checkout: `/Users/hafi/Claude/nascon`.
- **Day 2 push windows (PKT):** W1 10:15–11:30 · W2 11:30–12:45 · W3 12:45–13:45 · **W4 13:45–14:05**. **Hard deadline 14:05:00**: commits pushed after that are ignored. Aim to finish by ~13:55.
- Day 1 base SHA **`fcf5aa3`** must stay an ancestor of the final Day 2 HEAD (check: `git merge-base --is-ancestor fcf5aa3 HEAD`).
- **Salts come ONLY from env** (`DAY1_SALT`, `DAY2_SALT`). Hard-coding `DAY2_SALT` in source voids credit. They live in the git-ignored `.env`; ask Hafi for the values. Never commit them, including in this file.
- In-person evaluation follows the sprint (Day 1 it was ~15:00).

## 2. Stack and architecture

- Backend: NestJS 12 (ESM, `.js` import suffixes), plain `pg` (JSONB `docs` table + dedicated tables), Redis 7 Streams (`domain-events`), vitest. Node 20 alpine image.
- Mobile: React Native 0.88.0, Android only, `mobile/`. **Current UI = Haider's "CLUB|HOUSE"** (merged 12:48, commit `0b4d890`).
- docker-compose services: `postgres`, `redis`, `mediamtx` (`bluenviron/mediamtx:1.9.1-ffmpeg`, RTMP 1935 / HLS 8888 / WebRTC 8889 / API 9997), `api` (8080), `selenium-hub` (4444) + `node-chrome-1`, `node-chrome-2`, `node-firefox`; `minio` only under profile `objectstore`. All have healthchecks (IPv4 `127.0.0.1`; `localhost` resolved to ::1 and broke them).
- MediaMTX `authMethod: http` → `POST /internal/media/auth` (API authorises every publish/read); MediaBridge kicks publishers within ~1 s of a key revoke, samples bitrate, indexes VOD.
- DAY2 signature: `HMAC-SHA256(DAY2_SALT, entity_id + "|" + canonical(payload))`, canonical = sorted keys, no whitespace. `signDay2()` in `backend/src/common/canonical.ts`.
- Guest boundary: `backend/src/qr_guest/guest-guard.ts`; guest tokens `guest_…` are read-only except `/api/v1/guest/token`, `/api/v1/guest/cart` (403 `GUEST_WRITE_FORBIDDEN`).
- Realtime: SSE (match + chat) and WebSockets `ws://…/ws/matches/{id}` and `ws://…/ws/costream/{id}?player_id=` (host disconnect → handoff after 1 s grace, < 1.5 s total).
- Key code: `backend/src/day2/day2.controller.ts` (all Day 2 routes), `streaming/` (stream keys, media bridge), `costream/`, `qr_guest/`, `moderation_dlq/`, `observability/metrics.ts`, `extras/`, `web/` (guest web player: `web.ts`, `player.css`, `player.js`).

## 3. Run it

```bash
cd nascon
# .env (git-ignored): DAY1_SALT=…  DAY2_SALT=…
# Apple Silicon also needs: SELENIUM_HUB_IMAGE=selenium/hub:4.24.0 SELENIUM_CHROME_IMAGE=selenium/node-chromium:4.24.0 SELENIUM_FIREFOX_IMAGE=selenium/node-firefox:4.24.0
docker compose up -d --build
docker compose ps                      # all (healthy)
curl localhost:8080/health             # {"status":"ok"}
```

Tests:
```bash
cd backend && npx vitest run                       # 149 tests; ./run_tests.sh prints COVERAGE.json + COVERAGE_DAY2.json
set -a; . ./.env; set +a
python3 tests/smoke_test.py; python3 tests/smoke_day2.py             # contract probes (read API_URL, default http://localhost:8080)
python3 -m pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml   # resets demo data!
k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js
pytest tests/appium/ --junitxml=tests/reports/appium-report.xml      # needs Afnan's Phase 5
```

Mobile build (no Metro needed, JS bundle is embedded):
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
cd mobile && npm install && cd android && ./gradlew assembleDebug --offline
cp app/build/outputs/apk/debug/app-debug.apk ../release/app-release.apk
```

## 4. Status (all verified)

| Phase | Owner | State |
|---|---|---|
| 1 Backend contracts (stream key, media auth, co-stream, QR resolve/exports, /q/{code}, guest token/cart/merge, moderation+DLQ, /metrics, privacy delete, SSE) | Claude | Done. smoke_day2: 38 checks + 22 Phase 6 checks, 0 failures |
| 2 Infra (MediaMTX + Selenium Grid hub + 3 nodes, healthchecks) | Claude | Done. All 8 containers healthy |
| 3 Guest web player `/web/*` (9 data-testids, live score, chat, guest cart, auth modal + cart merge) | Claude | Done. Phone-width layout, HLS auto-retry, video host follows request host |
| 4 QA harness (Selenium, Appium, k6, GitHub Actions autograde, reports, COVERAGE_DAY2.json) | Haider (chosen over Claude's) | Done. Selenium 12/12, k6 0% errors p95 ~70–100 ms in-network |
| 5 Mobile (deep links, Match Live + Co-stream screens, APK) | **Afnan** | **NOT DONE**. See §6 |
| 6 Extras (co-stream invites/join/host controls, moderator actions, athlete profiles, variant pricing, inventory audit, orders, follow/restock) | Claude | Done. Unit coverage for Day 2 areas 100% |
| UI | Haider | His CLUB|HOUSE UI merged into main at 12:48 (`0b4d890`), APK rebuilt and tested |

CI (`.github/workflows/autograde.yml`): green on `e764bba` and `f15f581`; `0b4d890` was in progress at 12:52 (only mobile/docs changed). Job env `API_URL=http://localhost:8080`; `BASE_URL=http://api:8080` is set only on the Selenium step (it broke the probes when job-wide).

Recent main history: `0b4d890` merge Haider UI · `f15f581` W3 Selenium report · `70dd5f2` video follows page host + `PUBLIC_BASE_URL` passthrough · `031cdd0` HLS auto-retry · `e764bba` phone layout · `fc1ddcb` hardening.

## 5. Where live streaming lives today

- **Backend + MediaMTX:** working. Generate a key, publish, watch:
  ```bash
  curl -X POST localhost:8080/audit/v1/stream/key -H 'content-type: application/json' -d '{"action":"generate","player_id":"player-alpha-1"}'
  ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -g 30 -c:a aac -f flv rtmp://localhost:1935/live/<stream_key>
  # HLS: http://localhost:8888/live/<stream_key>/index.m3u8   (or OBS → rtmp://<laptop-ip>:1935/live/<stream_key>)
  ```
  `{"action":"revoke"}` cuts the publisher within ~1 s.
- **Guest web player (phone browser):** `http://<host>:8080/q/m1-live` → `/web/matches/match-m1/live`. It plays the newest active stream key with the live score, chat and pinned jersey. Verified on both phones.
- **Mobile app:** **no live-video screen yet.** Neither our old UI nor Haider's has one. It is Phase 5 (Afnan): Match Live screen (`screen-match-live`) and Co-stream screen (`screen-costream`). Quickest fallback if Afnan runs out of time: a "Watch live" button on the match screen that calls `Linking.openURL(server + '/web/matches/' + id + '/live')`, opening the working web player.

## 6. Remaining work (in order)

1. **Afnan, Phase 5** (contract: `docs/day2/05-mobile.md`, acceptance tests: `tests/appium/`). He must **pull main first**: `App.tsx` is now Haider's.
   - `AndroidManifest.xml` intent-filter for scheme `nascon` (hosts `entity`, `stream`) plus `http(s)://<host>/q/*`.
   - Deep-link router (`Linking.getInitialURL` + `addEventListener('url')`): `nascon://entity/match-*` → Match Live; `nascon://stream/cs-session-*` → Co-stream. Must open without login (guest token, read-only).
   - testIDs: `screen-match-live`, `screen-costream`, `costream-chat-input`, `costream-chat-send`, `chat-message-list`.
   - Match Live: HLS video (react-native-video needs a native rebuild; WebView or opening the web player is the fallback), live score over WS/SSE.
   - Rebuild the APK into `mobile/release/app-release.apk`, run `pytest tests/appium/` on a phone over USB.
   - If nothing has landed by ~13:15, ask Hafi whether Claude should build the minimal version.
2. **13:30 feature freeze** → regenerate reports (Selenium, k6, Appium), check `COVERAGE_DAY2.json`.
3. **W4 (13:45–13:55):** `git pull --rebase`, final push, confirm CI green and `fcf5aa3` ancestry. Nothing after 14:00.
4. **Demo script:** organiser scores on Phone A → viewer Phone B updates (< 3 s); QR → guest web player with live video; guest adds jersey → sign in (`player@nascon.test` / `Nascon@26`) → cart merges; swear word in chat gets masked; revoke stream key → video cut < 1 s; co-stream host drop → handoff; show Selenium Grid (localhost:4444) and k6 numbers.

## 7. Phones and demo setup

- Infinix X695 (Android 11) serial `067682514G102521`; Samsung Galaxy A15 (Android 16) serial `RF8X20LTJ4P` (tick "Always allow" for USB debugging or it drops to unauthorized).
- Over USB: `adb -s <serial> reverse tcp:8080 tcp:8080 && adb -s <serial> reverse tcp:8888 tcp:8888`, app server address `http://localhost:8080`.
- Over hotspot: laptop IP was `172.15.59.9` at 12:35 (check `ipconfig getifaddr en0`); app server address `http://<ip>:8080`. For printed QR codes set `PUBLIC_BASE_URL=http://<ip>:8080` in `.env` and `docker compose up -d api`. Chrome shows a one-time "doesn't support a secure connection" page for plain HTTP on a LAN IP: tap **Continue to site**.
- Demo accounts (password `Nascon@26`): `admin@`, `organizer@`, `manager@`, `player@`, `viewer@nascon.test`. Login screen has quick-fill chips.
- `POST /audit/v1/reset` restores baseline data (Selenium runs call it, so scores change after a test run).

## 8. Gotchas learned

- Push to `main` only after `git pull`; Haider and Afnan push too. Never leave the tree dirty when a scheduled `git pull --rebase` job is due.
- Metro does not follow a symlinked `node_modules` (use `cp -cR` clone in a worktree). Gradle needs `ANDROID_HOME` or `android/local.properties`.
- k6 from the macOS host shows ~2% connection resets (somaxconn 128 via port forwarder); inside the docker network it's 0%. API listens with backlog 4096 + container `somaxconn` 4096.
- Exact headers matter: SVG export is `image/svg+xml` (no charset); `/metrics` is `text/plain; version=0.0.4`.
- Ownership (CLAUDE.md): `backend/src/**` Hafi/Claude, `backend/src/fixtures/**` Haider, `mobile/**` Afnan; `docker-compose.yml`, `backend/package.json`, `app.module.ts` Hafi only.
- Plans per phase: `docs/day2/00–06*.md`. Decisions: `ADR.md` (ADR-1..9). Requirements map: `TRACEABILITY.md`.
