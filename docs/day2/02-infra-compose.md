# Phase 2 — Infrastructure & Compose

## Services to add to `docker-compose.yml`
| Service | Image | Ports | Notes |
|---|---|---|---|
| `mediamtx` | `bluenviron/mediamtx:1.9.1` (pulled) | 1935, 8888, 8889 | `mediamtx.yml`: paths `live/~^sk_live_` with `authHTTPAddress: http://api:8080/internal/media/auth`; API enabled for kick on revoke; recordings → `/recordings` volume |
| `minio` | see risk below | 9000 | VOD storage (FR-3.2 recording) |
| `selenium-hub` | `selenium/hub:4.24.0` (pulled) | 4444, 4442, 4443 | container_name `nascon-selenium-hub` |
| `node-chrome-1`, `node-chrome-2` | `selenium/node-chrome:4.24.0` (amd64 for the grader) | — | `shm_size: "1gb"`, `SE_START_VNC=false`, `SE_NODE_MAX_SESSIONS=2` |
| `node-firefox` | `selenium/node-firefox:4.24.0` | — | same env |
| `api` | build | 8080 | add `DAY2_SALT: ${DAY2_SALT}`, `MEDIAMTX_URL`, `extra_hosts: host.docker.internal:host-gateway` |

- **Apple Silicon local runs:** `docker-compose.arm64.yml` override swapping chrome nodes to `selenium/node-chromium:4.24.0` (pulled). Grader uses the base file.
- Browser nodes reach the web player at `http://api:8080/web/...` (same network) — tests use `BASE_URL` env.

## Risks / decisions
- **MinIO image can't be pulled publicly** (Docker Hub repo deleted, quay 401). Options: (a) build from source in compose (`build: ./infra/minio`, Go build ~3 min on grader — inside 10 min budget but slow), (b) store VOD in a Postgres/local volume and expose via API, document in ADR. **Decision: (b) by default; add (a) only if time remains.** Write ADR-9.
- 3 browser nodes + Postgres + Redis + MediaMTX + API on an 8 GB runner: keep `SE_NODE_MAX_SESSIONS=2`, no VNC.
- Health: api must not depend on selenium being healthy (start order irrelevant to `/health`).

## Done when
`docker compose up -d --build` → `curl :8080/health` 200, `curl :4444/status` → `ready:true`, 3 nodes; `ffmpeg`/OBS publish to `rtmp://localhost:1935/live/<key>` works with a valid key and is refused with a revoked key.
