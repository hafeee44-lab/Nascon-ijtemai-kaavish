# Day 2 (Part II) — Execution Plan

**Sprint:** 10:15 – 14:00 PKT · **Hard lock:** 14:05:00 · **Base SHA (must stay ancestor):** `fcf5aa3`
**Weight:** 80% backend + automated QA infra · 20% frontend (mobile + guest web player)

## Push windows (missing one = penalty)
| Window | Time | Planned commit |
|---|---|---|
| W1 | 10:15 – 11:30 | This plan (`docs/day2/`) |
| W2 | 11:30 – 12:45 | Phase 1 backend contracts |
| W3 | 12:45 – 13:45 | Phases 2–4 (compose, guest web, QA) |
| W4 | 13:45 – 14:05 | Phase 5 + final reports/coverage — push by **13:55** |

## Phases
| # | File | Scope | Points |
|---|---|---|---|
| 1 | `01-backend-contracts.md` | All new `/audit/v1/*` routes, DAY2 signing, reset seed, guest 403 guard, `/metrics`, privacy | biggest (80% pool) |
| 2 | `02-infra-compose.md` | MediaMTX, Selenium Hub + 3 nodes on 4444, health checks, DAY2_SALT | disqualification risk |
| 3 | `03-guest-web-player.md` | `/web/*` HTML with 9 `data-testid`s, live score SSE/WS, chat, guest cart, auth modal | frontend + Selenium |
| 4 | `04-qa-harness.md` | `tests/selenium`, `tests/appium`, `tests/k6_load.js`, reports, GitHub Actions, COVERAGE_DAY2 | backend QA pool |
| 5 | `05-mobile.md` | `nascon://` intent-filter, deep-link screens, co-stream view, QR | frontend |
| + | `06-extras.md` | Restock, follow/unfollow, athlete profile, order admin — the "judge asked" features | viva |

## Contract truths (copy literally — do not "improve")
- Signature: `HMAC-SHA256(DAY2_SALT, entity_id + "|" + canonical(sig_payload))`, separator is a **pipe `|`**, canonical = sorted keys, `,` `:` separators, UTF-8 unescaped. Reuse Day 1 `canonical()`; add `signDay2()` reading `process.env.DAY2_SALT` (never hard-coded).
- Ports: API **8080**, Selenium Hub **4444**, Appium **4723**, RTMP **1935**, HLS **8888**, WebRTC **8889**.
- Status codes: stream key `generate` → **201**, `rotate`/`revoke` → **200**; co-stream new → **201**, identical replay → **200**; cart-merge → **200**.
- All 9 `data-testid`s on `/web/matches/{id}/live` and `/web/costream/{id}` are mandatory.
- Validation order: 400 → 404 → 403 → 409. Error envelope unchanged from Day 1.
- `/audit/v1/*` stays exempt from rate limiting (k6 runs 550 VUs).

## Ownership (avoid overwrites — pull before every push)
| Area | Owner |
|---|---|
| `backend/**`, `docker-compose.yml` | Hafi + Claude |
| `backend/src/web/**` (guest web player HTML/JS) | Claude (Phase 3) |
| `tests/selenium`, `tests/appium`, `tests/k6_load.js`, `.github/workflows` | Haider |
| `mobile/**` | Afnan (Claude rebuilds APK at the end) |
| `TRACEABILITY.md`, `COVERAGE_DAY2.json`, `ADR.md` | Claude, last 15 min |

## Definition of done (Appendix C)
`DAY1_SALT=… DAY2_SALT=… docker compose up -d --build` healthy < 120 s · reset seeds `match-m1`, `player-beta-2`, `guest_anon_tok_7721`, 3 QR maps · every contract exact + signed · `:4444/status` ready with ≥ 3 nodes · 9 test-ids present · `:4723/status` ready + `nascon://entity/match-m1` opens the app · k6 15 s at 0% 5xx · reports + `COVERAGE_DAY2.json` + `TRACEABILITY.md` pushed before 14:05.
