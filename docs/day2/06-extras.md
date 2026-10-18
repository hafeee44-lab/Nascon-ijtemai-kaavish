# Extras — features judges asked about (do after Phases 1–4 are green)

| Feature | API | Rules | Why |
|---|---|---|---|
| **Restock** | `POST /api/v1/inventory/{variant_id}/restock` `{quantity, reason}` | super_admin or club_manager of the product's club; quantity 1..1000; atomic `UPDATE inventory SET stock = stock + $q`; audit row; domain event `inventory.restocked` (SSE + queue) | Asked at Day 1 desk |
| **Set price / scheduled price change** | `POST /api/v1/variants/{id}/price` `{price_minor, effective_at}` | price history table; checkout uses price effective now | Day 1 FR-2.3 gap |
| **Order admin** | existing `PATCH /api/v1/orders/{id}/status` + app screen | Packed → Shipped → Delivered / Refunded (restock) | show lifecycle in UI |
| **Follow / unfollow athlete** (FR-3.1) | `PUT/DELETE /api/v1/athletes/{id}/follow` | idempotent per (follower, athlete) via unique key; count = `COUNT(*)` (no drift); guest → 403 | Day 2 FR-3.1 |
| **Athlete profile** (FR-3.1) | `GET /api/v1/athletes/{id}` | career record from event logs, club, upcoming fixtures, VOD list | Day 2 FR-3.1 |
| **Moderator actions** | `POST /api/v1/chat/{room}/mute|kick` | idempotent, dedup | Edge case 3 |

All write routes go through the guest guard (403 `GUEST_WRITE_FORBIDDEN`) and RBAC.
