# NaSCon '26: Multi-Sport League & Club Operations Platform

Team **Aik kachori do Samosa**.

## Run the backend

```bash
DAY1_SALT=<your-salt> docker compose up -d --build
curl http://localhost:8080/health   # {"status":"ok"}
```

Services: `api` (NestJS on host port 8080), `postgres` (PostgreSQL 16), `redis` (Redis 7 Streams, internal domain-event queue). The stack seeds itself on first start; `POST /audit/v1/reset` restores the baseline. See `.env.example` for all variables.

## Tests

```bash
./run_tests.sh                       # unit tests + coverage per graded area (COVERAGE.json)
python3 tests/smoke_test.py          # end-to-end contract checks against the running stack
```

## Demo accounts (password for all: `Nascon@26`)

| Role | Email |
|---|---|
| Platform Super-Admin | admin@nascon.test |
| League Organizer (owns league-alpha-1) | organizer@nascon.test |
| Club Manager (owns club-alpha-1) | manager@nascon.test |
| Player (player-alpha-1) | player@nascon.test |
| General Viewer | viewer@nascon.test |

## Mobile app (Android)

- Install: `adb install -r mobile/release/app-release.apk` (Android 10+, arm64).
- The phone and laptop must be on the same network (team hotspot). On the login screen or in **Settings**, set the server address to `http://<laptop-LAN-IP>:8080` (emulator: `http://10.0.2.2:8080`).
- Navigation is role-aware: Organizer/Admin get **Match control** (live fixtures → scoring console), Manager gets **Squad**, Player gets **My Club**, Viewer gets **Clubs**; everyone has Home, Calendar, Table and Store.
- Offline demo: open Home, Table and Squad while online. Switch to airplane mode, add a score (Organizer, Match control → scoring console) or move a player (Manager, Squad), force-close, reopen, then go back online. The queue syncs automatically and per-action results appear under the bell icon (**Activity and sync**).
- UI preview in a browser (no phone needed): `npm --prefix mobile/web install && npm --prefix mobile/web start` → http://127.0.0.1:4186 (proxies the API on :8080).
- Rebuild: `cd mobile/android && ./gradlew assembleDebug --offline` (the JS bundle is embedded, so no Metro is needed), then copy `app/build/outputs/apk/debug/app-debug.apk` to `mobile/release/app-release.apk`.

## Architecture

See `ADR.md` (decisions) and `TRACEABILITY.md` (requirements → code → tests).

---

# Part II (Day 2) — Live streaming, dynamic QR, guest web player, grid QA

## Run everything

```bash
# Salts come only from the environment (never commit them). A local .env is git-ignored:
#   DAY1_SALT=...   DAY2_SALT=...
DAY1_SALT=<day1-salt> DAY2_SALT=<day2-salt> docker compose up -d --build
docker compose ps        # every service reports (healthy)
curl http://localhost:8080/health          # {"status":"ok"} once DB, Redis and the media server are ready
curl http://localhost:4444/status          # Selenium Grid: ready, 3 nodes
```

| Service | Port(s) | Notes |
|---|---|---|
| API + Guest Web Player | 8080 | `/audit/v1/*`, `/api/v1/*`, `/web/*`, `/q/{code}`, `/metrics`, `ws://…/ws/matches/{id}`, `ws://…/ws/costream/{id}?player_id=` |
| MediaMTX | 1935 RTMP · 8888 HLS · 8889 WebRTC (WHIP/WHEP) · 8189/udp | Every publish/read is authorised by the API (`/internal/media/auth`); revoked keys are cut within ~1 s |
| Selenium Grid 4 | 4444 (hub) + 2× Chrome + 1× Firefox | `shm_size: 1gb`, VNC off |
| Postgres / Redis | internal | Redis Streams `domain-events` is the internal event queue |

Apple Silicon: set `SELENIUM_HUB_IMAGE=selenium/hub:4.24.0`, `SELENIUM_CHROME_IMAGE=selenium/node-chromium:4.24.0`, `SELENIUM_FIREFOX_IMAGE=selenium/node-firefox:4.24.0` in `.env` (the defaults are the official 4.25.0 images the grader pulls). MinIO is optional: `docker compose --profile objectstore up -d` (see ADR-9).

## Try it

- **Phones on the hotspot:** the player fetches video from the same host the phone used for the page. To make printed/exported QR codes point at the laptop, set `PUBLIC_BASE_URL=http://<laptop-LAN-IP>:8080` in `.env` and restart `api` (default `http://localhost:8080`, used over USB with `adb reverse tcp:8080 tcp:8080` and `tcp:8888`). Chrome may show a one-time "site doesn't support a secure connection" notice for plain HTTP on a LAN IP; tap **Continue to site**.
- **QR → guest player:** open `http://localhost:8080/q/m1-live` (redirects to `/web/matches/match-m1/live`). No login; add the jersey to the cart; try to chat (you'll be asked to sign in — `player@nascon.test` / `Nascon@26` — and the cart moves to your account).
- **QR exports:** `/audit/v1/qr/match-m1/export.svg|png|pdf`.
- **Go live:** `POST /audit/v1/stream/key {"action":"generate","player_id":"player-alpha-1"}` → publish with OBS or
  `ffmpeg -re -f lavfi -i testsrc -c:v libx264 -f flv rtmp://localhost:1935/live/<stream_key>` → watch `http://localhost:8888/live/<stream_key>/index.m3u8`.
- **Co-stream:** `POST /audit/v1/costream/session` → host invites with `POST /api/v1/costream/{id}/invites`, guests join with the signed token, host controls via `/control`; if the host's WebSocket drops, hosting hands over in < 1.5 s.

## Tests

```bash
./run_tests.sh                                    # unit tests; prints COVERAGE.json + COVERAGE_DAY2.json figures
python3 tests/smoke_test.py && python3 tests/smoke_day2.py      # contract probes (export DAY1_SALT/DAY2_SALT)
pip install -r tests/requirements.txt
pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml   # Grid 4, Chrome + Firefox in parallel
pytest tests/appium/ --junitxml=tests/reports/appium-report.xml            # phone on USB, Appium on :4723
k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js     # 500 viewers + 50 chat posters, 15 s
```

CI (`.github/workflows/autograde.yml`) runs the same chain on every push to `main`. Requirements → code → tests: `TRACEABILITY.md`; design decisions: `ADR.md`; phase plans: `docs/day2/`.
