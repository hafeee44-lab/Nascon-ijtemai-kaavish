# Phase 4 — Automated QA harness (Selenium Grid 4, Appium 2, k6, CI)

## Selenium — `tests/selenium/test_guest_grid.py` (run `pytest -n 3 tests/selenium/`)
- Needs `pytest-xdist` (**not installed yet — `pip install pytest-xdist` while network allows**). Remote driver `http://localhost:4444`, parametrize chrome/firefox, `BASE_URL` env (default `http://api:8080` inside grid network, `http://host.docker.internal:8080` fallback).
- Test 1: `/q/m1-live` → URL ends `/web/matches/match-m1/live`; video + score visible < 3 s; modal hidden.
- Test 2: type + send as guest → list unchanged, modal visible.
- Test 3: add-to-cart → count "1"; POST `/audit/v1/events` score → banner text changes within 500 ms (poll with 50 ms waits).
- `--junitxml=tests/reports/selenium-report.xml`.

## Appium — `tests/appium/test_mobile_deeplink.py`
- Server `http://localhost:4723` (verified working on the Infinix yesterday; helper apps already installed).
- `adb shell am start -W -a android.intent.action.VIEW -d "nascon://entity/match-m1"` → assert app foreground + Match Live screen element (`accessibility id`). Same for `nascon://stream/cs-session-101`.
- Cross-surface: Appium opens co-stream chat, Selenium opens `/web/costream/cs-session-101`, message from one appears on the other < 3 s.
- `--junitxml=tests/reports/appium-report.xml`.

## k6 — `tests/k6_load.js`
Commit the spec's script **verbatim** (§6.4) (fix only its obvious paste typos: the `run` stray token, `const res` order). Run: `k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js`. Backend prep: `/audit/v1/qr?inspect=true` must be cheap (cache entity status 250 ms), DB pool ≥ 30.

## CI — `.github/workflows/autograde.yml`
On push to main: checkout → `docker compose up -d --build` (DAY1/DAY2 salts from secrets or dummy) → wait health → `python tests/smoke_test.py` + `tests/smoke_day2.py` → `curl :4444/status` node check → k6 smoke (`--vus 20 --duration 5s`) → upload `tests/reports`.

## Coverage — `COVERAGE_DAY2.json`
`{streaming, costream, qr_guest, moderation_dlq, observability}` from real vitest numbers (extend `scripts/coverage-areas.mjs`).

## Done when
All three suites produce reports in `tests/reports/`, committed.
