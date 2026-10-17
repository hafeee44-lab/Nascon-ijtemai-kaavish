# NaSCon '26 — Multi-Sport League & Club Operations Platform

Team **Aik kachori do Samosa**.

## Run the backend

```bash
cp .env.example .env   # put the team salt in DAY1_SALT
DAY1_SALT=<your-salt> docker compose up -d --build
curl http://localhost:8080/health   # {"status":"ok"}
```

Services: `api` (NestJS on host port 8080), `postgres` (PostgreSQL 16), `redis` (Redis 7, domain-event queue).

## Tests

```bash
./run_tests.sh
```

## Demo accounts (password for all: `Nascon@26`)

| Role | Email |
|---|---|
| Platform Super-Admin | admin@nascon.test |
| League Organizer (owns league-alpha-1) | organizer@nascon.test |
| Club Manager (owns club-alpha-1) | manager@nascon.test |
| Player (player-alpha-1) | player@nascon.test |
| General Viewer | viewer@nascon.test |

## Mobile

React Native (Android) app in `mobile/`. Release APK: `mobile/release/app-release.apk`.
The server address is set on the app's Settings screen (emulator: `10.0.2.2:8080`, phone: the laptop's LAN IP).
