# Local web runner

Uses the actual React Native App.tsx through React Native Web, with localStorage caching, sessionStorage tokens, real confirmation dialogs and PDF downloads. No mocked API data.

1. From repo root: `DAY1_SALT=local-ui-development docker compose -p nascon-local-ui up -d --build`
2. Here: `npm install && npm start`
3. Open http://127.0.0.1:4186 (or append `?demo=organizer` for a real seeded demo-account login).

Other roles: manager, player, viewer, admin. All demo passwords are Nascon@26. The API is proxied to localhost:8080. Never use the development salt as a competition salt. Browser session tokens are not Android Keystore storage; Android continues using the native bridge.
