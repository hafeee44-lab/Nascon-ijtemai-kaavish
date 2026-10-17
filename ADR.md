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

## ADR-5b: Domain events fan out to a durable queue and a realtime bus
**Context:** Order transitions must reach an internal queue; match status and pinned products must reach connected clients live. **Decision:** One `DomainEvents.emit()` publishes after commit to Redis Streams (`XADD domain-events`, for workers) and to an in-process bus that `GET /api/v1/stream` fans out as Server-Sent Events. **Consequences:** One publish call serves both needs. SSE is one-way and proxy-friendly; a queue outage never fails a request.

## ADR-6: Policy-as-code RBAC with stateless JWTs
**Context:** Five roles, strict tenant isolation, 70-cell negative matrix. **Decision:** One pure `can(principal, action, target)` function; tenant mismatch denies before any role logic; super-admin bypasses. HS256 JWTs verified with a pinned algorithm list (rejects `alg:none`), with 401 → 404 → 403 evaluation order. **Consequences:** The whole matrix is unit-tested cell by cell; adding a route means adding one action.

## ADR-7: Offline-first mobile with a server-side conflict resolver
**Context:** The app must work in airplane mode and survive force-close. **Decision:** The app caches one `GET /api/v1/bootstrap` snapshot and queues actions in the exact `offline-sync` format in on-device SQLite, written by a small native module. Sync replays through `POST /audit/v1/offline-sync`, which reuses the same domain services, so the same rules apply online and offline. **Consequences:** One code path for online and offline writes; conflicts resolved server-side (`server_wins`, `rebased_append`).

## ADR-8: Zero third-party native dependencies in the app
**Context:** Campus network too slow to download extra native libraries. **Decision:** A ~100-line Kotlin module provides SQLite storage, Android-Keystore AES-GCM token encryption and PDF saving; connectivity is detected by probing `/health`; navigation is a small JS stack. **Consequences:** The APK builds fully offline from cached Gradle artifacts. We own more code, but it is small and auditable.
