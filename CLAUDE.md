# Instructions for AI agents (Codex, Claude, Copilot)

The binding spec is the organisers' PDF "NaSCon 26 App Dev Part 1". Each teammate gives it to their own agent; it is deliberately not in this repo. Field names, status codes and error codes are compared **literally** by the grader. Copy them exactly.

## Stack (fixed)
- Backend: NestJS 12 (ESM, `.js` import suffixes) on `node:20-alpine`, PostgreSQL 16 via plain `pg` (no ORM), Redis 7. Tests: vitest.
- Mobile: React Native **0.88.0** (Android only) in `mobile/`.
- Banned: Firebase, Supabase, any BaaS, Prisma, third-party fixture/bracket libraries.

## Ownership (only edit your own area)
| Area | Owner | Path |
|---|---|---|
| Core, scoring/events, standings, store, roster, RBAC, offline-sync | Hafi + Claude | `backend/src/**` except `fixtures/` |
| Fixture algorithms (`POST /audit/v1/fixtures`) | Haider + Codex | `backend/src/fixtures/**` |
| Mobile app | Afnan | `mobile/**` |
| `docker-compose.yml`, `backend/package.json`, `backend/src/app.module.ts` | Hafi only | ask before changing |

## Conventions
- Throw `ApiError` from `backend/src/common/api-error.ts`. Never return raw Nest errors. Error body: `{"error":{"code","message","details"}}`.
- Validation order: malformed/schema 400 → unknown id 404 → business rule 409.
- Never branch on a sport or event name ("football", "goal"). Everything comes from the sport config (−8 points penalty otherwise).
- Signatures: use `sign()` from `backend/src/common/canonical.ts`.
- Every area needs vitest unit tests (≥85% line coverage per area).
- Keep `TRACEABILITY.md` updated with the FR/NFR IDs you implement.
- Commit small and often. Push windows: 10:45–11:45, 11:45–12:45, 12:45–13:45, 13:45–14:45. Final deadline 15:05:00.
