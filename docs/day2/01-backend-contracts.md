# Phase 1 — Backend contracts (target: pushed in W2, before 12:45)

New NestJS module folder per area so coverage maps cleanly to `COVERAGE_DAY2.json`:
`src/streaming`, `src/costream`, `src/qr_guest`, `src/moderation_dlq`, `src/observability`. Pure logic in plain `.ts` files with vitest specs; controllers stay thin.

## 1.0 Shared
- `signDay2(entityId, payload)` in `common/canonical.ts` using `DAY2_SALT` env. Unit-test against Appendix A vector 1 by computing with Python reference first.
- **Guest guard** (`GuestGuard` / middleware): any request whose `Authorization: Bearer guest_*` hits a write route → **403 `GUEST_WRITE_FORBIDDEN`** with `details.guest_token`. Must cover at least `POST /api/v1/chat`, `POST /audit/v1/checkout`, `POST /audit/v1/events` (graded), plus follow, roster, cart checkout.
- New `POST /api/v1/chat` (member chat post) so the guard has a real write target.

## 1.1 Reset extension (`POST /audit/v1/reset`)
Seed additionally: `player-beta-2` (club-beta-1) · `match-m1` (football, league-alpha-1, club-alpha-1 vs club-alpha-2, **in_progress, 1–0** via real events) · QR maps `match-m1 → m1-live`, `player-alpha-1 → p-alpha-1`, `club-alpha-1 → c-alpha-1`, scan_count 0 · guest token `guest_anon_tok_7721` (valid, unmerged) · empty cart for `player-alpha-1` · DLQ depth 0 · moderation lists empty.

## 1.2 `POST /audit/v1/stream/key`
- 400 action ∉ {generate, rotate, revoke}; 404 `PLAYER_NOT_FOUND`; revoke with no key → 404 `STREAM_NOT_FOUND`.
- Key = `stream_key_override` if given else `sk_live_` + 16 hex.
- generate → 201, rotate → 200 (old key invalidated), revoke → 200 with `status:"revoked"`, `ingest_endpoints:null`, `playback_url:null`.
- Response fields: player_id, label (default "default"), stream_key, status, ingest_endpoints{rtmp,webrtc}, playback_url, signature (entity = stream_key, payload = {action, player_id, status, stream_key}).
- Revoked key used later → 409 `KEY_REVOKED`. Wire MediaMTX `authHTTPAddress` → `POST /internal/media/auth` so publish with a revoked/unknown key is refused (FR-3.2 "sever within 2 s": on rotate/revoke call MediaMTX API `kick` for that path).

## 1.3 `POST /audit/v1/costream/session`
Order: schema 400 → players exist 404 → host ∉ participants 400 → >4 → 409 `COSTREAM_SESSION_FULL` → layout fit 400 `UNSUPPORTED_LAYOUT` → handoff rules exactly as spec §5.5. Persist session; identical replay → 200 same body; chat_room_id `chat-{session_id}`, composite url `http://localhost:8888/costream/{id}/index.m3u8`. Signature payload: {active_host, handoff_occurred, layout, participant_count, session_id, status}.

## 1.4 QR (`GET /audit/v1/qr/{entity_id}`, exports, `GET /q/{code}`)
- Entity types by prefix: `match-*`, `player-*`, `club-*`, `cs-session-*`. Unknown → 404 `QR_NOT_FOUND`. Auto-create mapping on first request for any existing entity (short code deterministic).
- `target_route` computed **live** from match status (upcoming/in_progress/completed/postponed|cancelled|abandoned → preview/live/vod/notice?state=).
- `scan_count` increments unless `?inspect=true`; telemetry stores only counts by device family + hour bucket (no IP/UA).
- Exports: SVG / PNG / PDF from one QR matrix generator (check npm cache for `qrcode`; else implement minimal generator — fallback: render via pdfkit + hand-rolled QR is too slow → use `qrcode` package if cached).
- `GET /q/{short_code}` → 302 Location = target_route.
- Signature payload: {entity_id, short_url, target_route}.

## 1.5 Guest cart merge (`POST /audit/v1/guest/cart-merge`)
400 schema → 404 PLAYER/VARIANT → 409 `OUT_OF_STOCK` (merged qty vs available stock) → write-block self-test (records 403) → atomic merge (single transaction, sum quantities, cap by stock) → token marked merged. Identical replay → 200 same cart; different payload/user → 409 `GUEST_TOKEN_ALREADY_MERGED`. Signature payload: {cart_merged, guest_token, registered_user_id, total_items, write_rejection_code}.

## 1.6 Moderation + DLQ (`POST /audit/v1/moderation/test`)
- Normalize: lowercase, @→a, 0→o, 1/!→i, 3→e, $→s, strip `_ . - *` and zero-width chars; dictionary: badword, porn, scam, fuck, shit, bitch, asshole, idiotspam. Mask offending **original token** with `***`.
- Flood: ≥4 identical consecutive chars (case-insensitive) or `!!!`/`???` → dropped, sender → `muted_users`. Profanity → kept masked, `flagged:true`, sender → `kicked_users` (dedup, order kept). Also 3-msgs/2s per sender → `rate_limit_exceeded`.
- Lists persisted per room with unique constraint → 10 concurrent identical calls stay deduplicated, no deadlock.
- DLQ: `simulate_failed_notifications:n` → n events through retry(3, exponential) → DLQ table; `queue_depth`, `undelivered_events`.
- Signature payload: {chat_room_id, flagged_count, kicked_users, queue_depth}.

## 1.7 Observability + privacy
- `GET /metrics` text/plain; version=0.0.4 with the 5 required gauges (+ http request counter).
- `DELETE /audit/v1/privacy/user/{id}` → anonymize name/email, revoke linked guest/viewer tokens → `{user_id, status:"anonymized", pii_retained:false, tokens_wiped:true}`.
- `/health` also checks Redis + MediaMTX reachability (but never fails the grader if MediaMTX is slow: 3 s timeout).

## 1.8 Realtime (NFR-1)
- `GET /api/v1/matches/{id}/stream` SSE (exists generically — add per-match route) and `ws://…/ws/matches/{id}` (use `ws` package if cached, else SSE only). Score event → broadcast < 500 ms.

## Done when
`tests/smoke_day2.py` passes against `docker compose up`; vitest ≥ 85% per Day 2 module; committed + pushed.
