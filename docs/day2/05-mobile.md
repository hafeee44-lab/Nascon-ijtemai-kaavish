# Phase 5 — Mobile app (Android)

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
