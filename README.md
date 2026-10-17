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
- Offline demo: open Fixtures, Standings and Club while online. Switch to airplane mode, add a score (Organizer, on a live match) or move a player (Manager, Club tab), force-close, reopen, then go back online. The queue syncs automatically and per-action results appear on the **Sync** tab.
- Rebuild: `cd mobile/android && ./gradlew assembleDebug --offline` (the JS bundle is embedded, so no Metro is needed), then copy `app/build/outputs/apk/debug/app-debug.apk` to `mobile/release/app-release.apk`.

## Architecture

See `ADR.md` (decisions) and `TRACEABILITY.md` (requirements → code → tests).
