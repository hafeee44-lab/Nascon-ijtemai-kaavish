# Architecture Decision Records

## ADR-1: NestJS + plain SQL (node-postgres), no ORM
**Context:** Every response shape is graded literally and time was 4 hours. **Decision:** NestJS for routing/DI, `pg` with hand-written SQL. Domain records are JSONB documents in one `docs` table; tables that need guarantees (`match_events`, `inventory`, `roster_audit`) get real schemas. **Consequences:** No ORM magic between us and the contract; fewer migrations. Cross-document queries are manual.

## ADR-2: Sports are data, never code
**Context:** A "mystery sport" is created during grading; branching on sport/event names costs 8 points. **Decision:** One `SportConfig` (scoring model, periods, scoring events, overtime, tie-breaks, roster rules) drives scoring, limits and standings. The four seeded sports use the same schema as `POST /audit/v1/sports`. **Consequences:** New sports work with no deploy. Logic branches only on `scoring_model` (event/innings/round).

## ADR-3: Append-only event log, score projected on read
**Context:** Corrections must not mutate history. **Decision:** `match_events` is insert-only; a correction is a signed `compensation` event. `project()` rebuilds the score from the log on every read and treats compensated events as neutral. Appends lock the match row (`SELECT … FOR UPDATE`) to keep sequence numbers gap-free. **Consequences:** Full audit trail, trivially correct standings after corrections. Reads cost O(events), which is fine at league scale.

## ADR-4: HMAC signatures over canonical JSON
**Context:** The grader recomputes signatures byte for byte. **Decision:** A single `canonical()` (recursively sorted keys, no whitespace, unescaped UTF-8) plus `sign()` = HMAC-SHA256(DAY1_SALT, id|payload), verified against the spec's test vectors in unit tests. The salt is only read from the environment. **Consequences:** One place to get wrong, and it is tested.

## ADR-5: Atomic conditional UPDATE for inventory
**Context:** 20 simultaneous buyers on the last unit must produce exactly one order. **Decision:** Reserve with `UPDATE inventory SET stock = stock − q, reserved = reserved + q WHERE variant_id = $1 AND stock >= q`, inside a transaction, locking variants in sorted order, plus `CHECK (stock >= 0)`. Payment failures release the reservation. **Consequences:** Overselling is impossible at the database level, without distributed locks.

## ADR-6: Domain events fan out to a durable queue and a realtime bus
**Context:** Order transitions must reach an internal queue; match status and pinned products must reach connected clients live. **Decision:** One `DomainEvents.emit()` publishes after commit to Redis Streams (`XADD domain-events`, for workers) and to an in-process bus that `GET /api/v1/stream` fans out as Server-Sent Events. **Consequences:** One publish call serves both needs. SSE is one-way and proxy-friendly; a queue outage never fails a request.

## ADR-7: Policy-as-code RBAC with stateless JWTs
**Context:** Five roles, strict tenant isolation, 70-cell negative matrix. **Decision:** One pure `can(principal, action, target)` function; tenant mismatch denies before any role logic; super-admin bypasses. HS256 JWTs verified with a pinned algorithm list (rejects `alg:none`), with 401 → 404 → 403 evaluation order. **Consequences:** The whole matrix is unit-tested cell by cell; adding a route means adding one action.

## ADR-8: Offline-first mobile with a server-side conflict resolver
**Context:** The app must work in airplane mode and survive force-close. **Decision:** The app caches one `GET /api/v1/bootstrap` snapshot and queues actions in the exact `offline-sync` format in on-device SQLite, written by a small native module. Sync replays through `POST /audit/v1/offline-sync`, which reuses the same domain services, so the same rules apply online and offline. **Consequences:** One code path for online and offline writes; conflicts resolved server-side (`server_wins`, `rebased_append`). The native layer is a ~100-line Kotlin module (SQLite storage, Android-Keystore AES-GCM token encryption, PDF saving) with no third-party native dependencies, so the APK builds fully offline from cached Gradle artifacts; connectivity is detected by probing `/health`.

## ADR-9: Media pipeline — MediaMTX with API-authorised keys; MinIO opt-in
**Context:** Part II needs RTMP/WHIP ingest, HLS/WHEP playback, revocation that cuts a live stream within 2 s, recording to object storage, and a stack that always starts on the grader. The public MinIO image can no longer be pulled (Docker Hub repo removed, quay.io requires auth). **Decision:** MediaMTX 1.9 asks `POST /internal/media/auth` before every publish/read, so only active stream keys work (revoked → 409 `KEY_REVOKED`). On revoke the API's `MediaBridge` kicks the live RTMP/WebRTC connections through the MediaMTX API (measured: cut in about 1 s), samples bitrate for `/metrics`, and indexes a VOD record when a recorded path goes offline. Recordings land on a shared `recordings` volume; MinIO is defined behind the `objectstore` Compose profile so a missing image can never block `docker compose up`. **Consequences:** Key lifecycle has one source of truth (the API). VOD storage is a volume, not S3, until an S3 image is available; switching is a storage adapter change, not a redesign.
