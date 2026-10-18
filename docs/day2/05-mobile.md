# Phase 5 — Mobile app (Android)

**Owner: Afnan** (starts after the backend phases). The Appium suite in `tests/appium/` is the acceptance test — make it green.

## Appium screen contract (must match `tests/appium/test_mobile_deeplink.py`)
| Element | React Native prop (either works) |
|---|---|
| Match Live screen root (opened by `nascon://entity/match-*`) | `testID="screen-match-live"` or `accessibilityLabel="screen-match-live"` |
| Co-stream screen root (opened by `nascon://stream/cs-session-*`) | `testID="screen-costream"` |
| Co-stream chat input | `testID="costream-chat-input"` |
| Co-stream chat send button | `testID="costream-chat-send"` |

- Intent must foreground the app in **≤ 2000 ms** (`am start -W` TotalTime) and land on the screen **without** the login screen.
- Co-stream chat must reach `/web/costream/cs-session-101` (`chat-message-list`) within **3 s**: post via `POST /api/v1/chat` with `chat_room_id: "chat-cs-session-101"` (member token); the web page receives it over SSE.
- Backend endpoints ready for the app: `GET /api/v1/costream/:id`, `GET /api/v1/chat/:room`, `GET /api/v1/chat/:room/stream` (SSE), `GET /api/v1/matches/:id/stream` (SSE score), `POST /api/v1/chat`, `GET /audit/v1/qr/:id`, `POST /api/v1/inventory/:variant/restock`, `POST|DELETE /api/v1/athletes/:id/follow`.

## Must-have (graded via Appium + desk)
1. **Intent-filter** in `AndroidManifest.xml` (MainActivity): VIEW + DEFAULT + BROWSABLE, `<data android:scheme="nascon" />`.
2. **Deep-link router** in `App.tsx`: `Linking.getInitialURL()` + `Linking.addEventListener('url')` → `nascon://entity/match-*` → Match Live screen; `nascon://entity/player-*|club-*`; `nascon://stream/cs-session-*` → Co-stream screen. Must open **without** stopping at login: if no session, use a guest token and show read-only screens.
3. **Co-stream screen**: participants grid (grid_2/grid_4/spotlight), active host badge, unified chat (`chat-cs-session-101`) with sequence numbers, host controls (mute/spotlight/kick buttons call API).
4. **Real-time notifications**: in-app banner from SSE events (score updates, co-stream invites, order status).

## Nice-to-have (only if time)
- QR scanner: no camera library cached → **"Scan code" screen with manual short-code entry + open-by-link**; document limitation.
- Solo broadcast: no WebRTC library offline → show stream key + RTMP URL + "Start with OBS/Larix" instructions; playback via HLS where possible.
- Restock + order-status admin screens (see `06-extras.md`).

## Build
`cd mobile/android && ./gradlew assembleDebug --offline` → copy to `mobile/release/app-release.apk` → install on phone → `adb reverse tcp:8080 tcp:8080`.
