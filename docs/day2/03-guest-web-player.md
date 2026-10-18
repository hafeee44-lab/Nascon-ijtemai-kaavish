# Phase 3 — Guest Web Player (`/web/*`, served by the API on 8080)

Server-rendered HTML + one small vanilla JS file (no build step → no npm/network risk, loads in < 3 s). Same "stadium night" visual language as the app (WCAG AA: contrast ≥ 4.5:1, focus rings, 48 px targets, ARIA labels on media controls, full keyboard use).

## Routes
`/web/matches/{id}/live|preview|vod|notice?state=`, `/web/players/{id}`, `/web/clubs/{id}`, `/web/costream/{id}`. Page load requests a guest token (`POST /api/v1/guest/token` → `guest_anon_tok_*`, stored in `sessionStorage`) — no login wall.

## Mandatory `data-testid`s (live + costream pages)
| testid | Element | Behaviour |
|---|---|---|
| `guest-video-player` | `<video>` in wrapper | HLS `playback_url` (native HLS on Safari; hls.js only if cached — otherwise show the `<video>` element with source + "stream offline" poster; element must be visible) |
| `live-score-banner` | `<div>` | "1 - 0"; updated via SSE `/api/v1/matches/{id}/stream` (< 500 ms), no reload |
| `pinned-merch-card` | `<div>` | prod-jersey-001 / var-jersey-001-L |
| `add-to-guest-cart-btn` | `<button>` | stages var-jersey-001-L ×1 (server `POST /api/v1/guest/cart` — read-only-safe staging) and bumps count |
| `guest-cart-count` | `<span>` | integer, "0" → "1" |
| `chat-message-list` | `<ul>` | live chat via SSE; masked words show `***` |
| `chat-input-field` | `<input>` | |
| `chat-send-btn` | `<button>` | guest → server returns 403 `GUEST_WRITE_FORBIDDEN` → message NOT appended → open modal |
| `progressive-auth-modal` | `<div role="dialog">` | hidden on load; login form (demo accounts); on success calls cart-merge and returns to same playback timestamp |

Overlay over the video: live score + club crests + pinned product chip, updated from SSE metadata (FR-3.2) without restarting the player.

## Done when
Manual check in Chrome: QR `/q/m1-live` → 302 → live page; score updates when an event is posted; send-chat as guest opens modal; add-to-cart shows 1; keyboard Tab reaches every control.
