"""Day 2 contract smoke tests (python3 tests/smoke_day2.py) against a running stack.

Signatures are recomputed with the spec's Appendix A reference function, so DAY2_SALT here must match the stack.
"""
import concurrent.futures as cf
import hashlib
import hmac
import json
import os
import sys
import urllib.request

# API_URL = how this runner reaches the API (BASE_URL is reserved for the grid browsers).
BASE = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")
SALT2 = os.environ["DAY2_SALT"]  # never commit the salt; export it from your .env
FAILS = []


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def call(method, path, body=None, headers=None, follow=True):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=20) as r:
            raw = r.read()
            ctype = r.headers.get("Content-Type", "")
            return r.status, (json.loads(raw) if "json" in ctype else raw), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except Exception:
            return e.code, raw, dict(e.headers)


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign2(entity, payload):
    return hmac.new(SALT2.encode(), (entity + "|" + canonical(payload)).encode(), hashlib.sha256).hexdigest()


def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"))
    if not cond:
        FAILS.append(name)


def reset():
    call("POST", "/audit/v1/reset", {})


def test_stream_keys():
    reset()
    s, b, _ = call("POST", "/audit/v1/stream/key", {"action": "rotate", "player_id": "player-alpha-1", "label": "OBS-Main-Desk", "stream_key_override": "sk_live_9f83a1b2c3d4e5f6"})
    want = sign2("sk_live_9f83a1b2c3d4e5f6", {"action": "rotate", "player_id": "player-alpha-1", "status": "active", "stream_key": "sk_live_9f83a1b2c3d4e5f6"})
    check("rotate 200 + appendix vector signature", s == 200 and b["signature"] == want and b["ingest_endpoints"]["rtmp"] == "rtmp://localhost:1935/live/sk_live_9f83a1b2c3d4e5f6"
          and b["playback_url"] == "http://localhost:8888/live/sk_live_9f83a1b2c3d4e5f6/index.m3u8", b)
    s, b, _ = call("POST", "/audit/v1/stream/key", {"action": "generate", "player_id": "player-alpha-2"})
    import re
    check("generate 201 + key format", s == 201 and re.match(r"^sk_live_[a-f0-9]{16}$", b["stream_key"]) and b["label"] == "default", b)
    s, b, _ = call("POST", "/audit/v1/stream/key", {"action": "revoke", "player_id": "player-alpha-1"})
    check("revoke 200 nulls", s == 200 and b["status"] == "revoked" and b["ingest_endpoints"] is None and b["playback_url"] is None, b)
    s, b, _ = call("GET", "/api/v1/streams/sk_live_9f83a1b2c3d4e5f6")
    check("revoked key 409 KEY_REVOKED", s == 409 and b["error"]["code"] == "KEY_REVOKED", b)
    s, b, _ = call("POST", "/audit/v1/stream/key", {"action": "revoke", "player_id": "player-beta-1"})
    check("revoke none 404 STREAM_NOT_FOUND", s == 404 and b["error"]["code"] == "STREAM_NOT_FOUND", b)
    s, b, _ = call("POST", "/audit/v1/stream/key", {"action": "explode", "player_id": "player-alpha-1"})
    check("bad action 400", s == 400 and b["error"]["code"] == "VALIDATION_ERROR", b)
    s, b, _ = call("POST", "/audit/v1/stream/key", {"action": "generate", "player_id": "player-zzz"})
    check("unknown player 404", s == 404 and b["error"]["code"] == "PLAYER_NOT_FOUND", b)


def test_costream():
    reset()
    body = {"session_id": "cs-session-101", "host_player_id": "player-alpha-1",
            "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"], "layout": "grid_4", "simulate_host_drop": True}
    s, b, _ = call("POST", "/audit/v1/costream/session", body)
    sig = sign2("cs-session-101", {"active_host": "player-alpha-2", "handoff_occurred": True, "layout": "grid_4", "participant_count": 3, "session_id": "cs-session-101", "status": "active"})
    check("host drop handoff 201", s == 201 and b["active_host"] == "player-alpha-2" and b["participant_count"] == 3 and b["handoff_occurred"] is True
          and b["active_participants"] == ["player-alpha-2", "player-beta-1", "player-beta-2"] and b["chat_room_id"] == "chat-cs-session-101"
          and b["composite_playback_url"] == "http://localhost:8888/costream/cs-session-101/index.m3u8" and b["signature"] == sig, b)
    s2, b2, _ = call("POST", "/audit/v1/costream/session", body)
    check("idempotent replay 200", s2 == 200 and b2 == b, s2)
    s, b, _ = call("POST", "/audit/v1/costream/session", {**body, "session_id": "cs-x", "participants": body["participants"] + ["player-alpha-1x"]})
    check("unknown participant 404 first", s == 404 and b["error"]["code"] == "PLAYER_NOT_FOUND", b)
    s, b, _ = call("POST", "/audit/v1/costream/session", {"session_id": "cs-1", "host_player_id": "player-alpha-1", "participants": ["player-alpha-1"], "simulate_host_drop": True})
    check("sole host drop terminated", s == 201 and b["status"] == "terminated" and b["active_host"] is None and b["participant_count"] == 0, b)
    s, b, _ = call("POST", "/audit/v1/costream/session", {"session_id": "cs-2", "host_player_id": "player-alpha-1", "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1"], "layout": "grid_2"})
    check("grid_2 overflow 400 UNSUPPORTED_LAYOUT", s == 400 and b["error"]["code"] == "UNSUPPORTED_LAYOUT", b)
    s, b, _ = call("POST", "/audit/v1/costream/session", {"session_id": "cs-3", "host_player_id": "player-beta-2", "participants": ["player-alpha-1"]})
    check("host not in participants 400", s == 400 and b["error"]["code"] == "VALIDATION_ERROR", b)


def test_qr():
    reset()
    s, b, _ = call("GET", "/audit/v1/qr/match-m1")
    sig = sign2("match-m1", {"entity_id": "match-m1", "short_url": "http://localhost:8080/q/m1-live", "target_route": "/web/matches/match-m1/live"})
    check("qr match-m1 live", s == 200 and b["short_url"] == "http://localhost:8080/q/m1-live" and b["target_route"] == "/web/matches/match-m1/live"
          and b["scan_count"] == 1 and b["entity_status"] == "in_progress" and b["deep_link_uri"] == "nascon://entity/match-m1" and b["signature"] == sig, b)
    s, b, _ = call("GET", "/audit/v1/qr/match-m1?inspect=true")
    check("inspect does not count", b["scan_count"] == 1, b)
    s, b, h = call("GET", "/q/m1-live", follow=False)
    check("short link 302", s == 302 and h.get("Location") == "/web/matches/match-m1/live", (s, h.get("Location")))
    call("POST", "/audit/v1/events", {"event_id": "end-1", "match_id": "match-m1", "type": "match_end", "payload": {}})
    s, b, _ = call("GET", "/audit/v1/qr/match-m1?inspect=true")
    check("target mutates to vod, same short_url", b["target_route"] == "/web/matches/match-m1/vod" and b["short_url"].endswith("/q/m1-live")
          and b["signature"] == sign2("match-m1", {"entity_id": "match-m1", "short_url": b["short_url"], "target_route": "/web/matches/match-m1/vod"}), b)
    s, b, _ = call("GET", "/audit/v1/qr/player-alpha-1?inspect=true")
    check("player route", b["target_route"] == "/web/players/player-alpha-1" and b["short_url"].endswith("/q/p-alpha-1"), b)
    s, b, _ = call("GET", "/audit/v1/qr/nope-1")
    check("unknown 404 QR_NOT_FOUND", s == 404 and b["error"]["code"] == "QR_NOT_FOUND", b)
    for fmt, magic, ctype in (("svg", b"<svg", "image/svg+xml"), ("png", b"\x89PNG\r\n\x1a\n", "image/png"), ("pdf", b"%PDF-", "application/pdf")):
        s, raw, h = call("GET", f"/audit/v1/qr/match-m1/export.{fmt}")
        check(f"export {fmt}", s == 200 and h.get("Content-Type", "").startswith(ctype) and raw.lstrip()[: len(magic)] in (magic, b"<?xml"[: len(magic)]), (s, h.get("Content-Type"), raw[:12]))
    reset()
    call("POST", "/audit/v1/events", {"event_id": "pp-1", "match_id": "match-m1", "type": "match_postpone", "payload": {}})
    s, b, _ = call("GET", "/audit/v1/qr/match-m1?inspect=true")
    check("postponed notice route", b["target_route"] == "/web/matches/match-m1/notice?state=postponed", b)


def test_guest():
    reset()
    g = {"Authorization": "Bearer guest_anon_tok_7721"}
    for path, body in (("/api/v1/chat", {"chat_room_id": "chat-x", "text": "hi"}), ("/audit/v1/checkout", {}), ("/audit/v1/events", {})):
        s, b, _ = call("POST", path, body, g)
        check(f"guest write 403 {path}", s == 403 and b["error"]["code"] == "GUEST_WRITE_FORBIDDEN", b)
    body = {"guest_token": "guest_anon_tok_7721", "registered_user_id": "player-alpha-1", "guest_cart": [{"variant_id": "var-jersey-001-L", "quantity": 1}], "test_write_block": True}
    s, b, _ = call("POST", "/audit/v1/guest/cart-merge", body)
    sig = sign2("guest_anon_tok_7721", {"cart_merged": True, "guest_token": "guest_anon_tok_7721", "registered_user_id": "player-alpha-1", "total_items": 1, "write_rejection_code": 403})
    check("cart merge 200", s == 200 and b["write_block_verified"] is True and b["write_rejection_code"] == 403 and b["active_cart"]["total_items"] == 1
          and b["active_cart"]["subtotal_minor"] == 450000 and b["active_cart"]["items"] == [{"variant_id": "var-jersey-001-L", "quantity": 1, "unit_price_minor": 450000}]
          and b["signature"] == sig, b)
    with cf.ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda _: call("POST", "/audit/v1/guest/cart-merge", body), range(4)))
    check("network replay stays total_items 1", all(r[0] == 200 and r[1]["active_cart"]["total_items"] == 1 for r in res), [r[0] for r in res])
    s, b, _ = call("POST", "/audit/v1/guest/cart-merge", {**body, "registered_user_id": "player-alpha-2"})
    check("reuse other user 409", s == 409 and b["error"]["code"] == "GUEST_TOKEN_ALREADY_MERGED", b)
    s, b, _ = call("POST", "/audit/v1/guest/cart-merge", {**body, "guest_token": "guest_new_1", "guest_cart": [{"variant_id": "var-jersey-001-M", "quantity": 5}]})
    check("over stock 409", s == 409 and b["error"]["code"] == "OUT_OF_STOCK" and b["error"]["details"]["variant_id"] == "var-jersey-001-M", b)
    s, b, _ = call("POST", "/audit/v1/guest/cart-merge", {**body, "guest_token": "guest_new_2", "guest_cart": [{"variant_id": "nope", "quantity": 1}]})
    check("unknown variant 404", s == 404 and b["error"]["code"] == "VARIANT_NOT_FOUND", b)
    s, b, _ = call("POST", "/audit/v1/guest/cart-merge", {**body, "guest_token": "anon"})
    check("bad token schema 400", s == 400, b)


def test_moderation():
    reset()
    body = {"chat_room_id": "chat-cs-session-101", "incoming_messages": [
        {"message_id": "msg-1", "sender": "user-guest-1", "text": "Clean sports commentary"},
        {"message_id": "msg-2", "sender": "user-spammer", "text": "Watch this illegal stream b@d_w0rd now!"},
        {"message_id": "msg-3", "sender": "user-flooder", "text": "GOAL! AAAA!!!"}], "check_dlq": True, "simulate_failed_notifications": 0}
    s, b, _ = call("POST", "/audit/v1/moderation/test", body)
    check("moderation example", s == 200 and [m["message_id"] for m in b["filtered_messages"]] == ["msg-1", "msg-2"]
          and b["filtered_messages"][1]["text"] == "Watch this illegal stream *** now!" and b["filtered_messages"][1]["reason"] == "profanity_leetspeak"
          and b["filtered_messages"][0]["flagged"] is False and b["filtered_messages"][0]["reason"] is None
          and b["kicked_users"] == ["user-spammer"] and b["muted_users"] == ["user-flooder"] and b["dlq_status"] == {"queue_depth": 0, "undelivered_events": []}
          and b["signature"] == sign2("chat-cs-session-101", {"chat_room_id": "chat-cs-session-101", "flagged_count": 1, "kicked_users": ["user-spammer"], "queue_depth": 0}), b)
    words = ["p.0.r.n", "s!c@m", "f*u*c*k", "a$$h0le", "bad_word", "idiot_spam", "sh1t", "b1tch"]
    s, b, _ = call("POST", "/audit/v1/moderation/test", {"chat_room_id": "r2", "incoming_messages": [{"message_id": str(i), "sender": "u", "text": f"hey {w} ok"} for i, w in enumerate(words)]})
    check("leetspeak dictionary", all(m["text"] == "hey *** ok" for m in b["filtered_messages"]), [m["text"] for m in b["filtered_messages"]])
    with cf.ThreadPoolExecutor(10) as ex:
        res = list(ex.map(lambda _: call("POST", "/audit/v1/moderation/test", body), range(10)))
    check("10 concurrent kicks dedup", all(r[0] == 200 and r[1]["kicked_users"] == ["user-spammer"] for r in res), [(r[0], r[1].get("kicked_users")) for r in res])
    s, b, _ = call("POST", "/audit/v1/moderation/test", {**body, "simulate_failed_notifications": 2})
    check("DLQ depth 2", b["dlq_status"]["queue_depth"] == 2 and len(b["dlq_status"]["undelivered_events"]) == 2, b["dlq_status"])


def test_metrics_privacy():
    s, raw, h = call("GET", "/metrics")
    text = raw.decode() if isinstance(raw, bytes) else str(raw)
    check("metrics content-type + gauges", s == 200 and h.get("Content-Type") == "text/plain; version=0.0.4"
          and all(n in text for n in ["nascon_active_ws_connections", "nascon_active_streams_total", "nascon_stream_bitrate_kbps", "nascon_dlq_depth", "nascon_qr_scans_total"]), (h.get("Content-Type"), text[:200]))
    s, b, _ = call("DELETE", "/audit/v1/privacy/user/player-alpha-1")
    check("privacy erase", s == 200 and b == {"user_id": "player-alpha-1", "status": "anonymized", "pii_retained": False, "tokens_wiped": True}, b)


def login(email):
    s, b, _ = call("POST", "/api/v1/auth/login", {"email": email, "password": "Nascon@26"})
    return {"Authorization": f"Bearer {b['token']}"}


def test_phase6_costream_controls():
    reset()
    host, manager = login("player@nascon.test"), login("manager@nascon.test")  # player@ is player-alpha-1
    call("POST", "/audit/v1/costream/session", {"session_id": "cs-session-200", "host_player_id": "player-alpha-1",
                                                "participants": ["player-alpha-1", "player-alpha-2"], "layout": "grid_4"})
    s, inv, _ = call("POST", "/api/v1/costream/cs-session-200/invites", {"player_id": "player-beta-1"}, host)
    check("host issues signed invite", s == 201 and "." in inv["invite_token"], inv)
    s, b, _ = call("POST", "/api/v1/costream/cs-session-200/invites", {"player_id": "player-beta-1"}, manager)
    check("non-host invite 403", s == 403, b)
    s, b, _ = call("POST", "/api/v1/costream/cs-session-200/join", {"invite_token": inv["invite_token"]}, host)
    check("join with invite", s == 200 and b["participant_count"] == 3 and "player-beta-1" in b["active_participants"], b)
    s, b, _ = call("POST", "/api/v1/costream/cs-session-200/join", {"invite_token": inv["invite_token"][:-2] + "00"}, host)
    check("forged invite 403", s == 403, b)
    s, b, _ = call("POST", "/api/v1/costream/cs-session-200/control", {"action": "mute", "participant_id": "player-beta-1"}, host)
    check("host mutes", s == 200 and b["muted"] == ["player-beta-1"], b)
    s, b, _ = call("POST", "/api/v1/costream/cs-session-200/control", {"action": "kick", "participant_id": "player-beta-1"}, host)
    check("host kicks", s == 200 and b["participant_count"] == 2 and b["signature"] == sign2("cs-session-200", {
        "active_host": b["active_host"], "handoff_occurred": b["handoff_occurred"], "layout": b["layout"],
        "participant_count": 2, "session_id": "cs-session-200", "status": b["status"]}), b)
    # WebSocket presence: host disconnects abruptly -> next participant takes over within 1.5 s
    import subprocess, time as t
    js = ("const W=require('./backend/node_modules/ws');const w=new W('ws://localhost:8080/ws/costream/cs-session-200?player_id=player-alpha-1');"
          "w.on('open',()=>setTimeout(()=>w.terminate(),300));w.on('close',()=>process.exit(0));setTimeout(()=>process.exit(1),5000)")
    subprocess.run(["node", "-e", js], check=True, timeout=10)
    t0 = t.monotonic()
    while t.monotonic() - t0 < 3:
        s, b, _ = call("GET", "/api/v1/costream/cs-session-200")
        if b["active_host"] == "player-alpha-2":
            break
        t.sleep(0.1)
    check("ws disconnect handoff < 1.5 s", b["active_host"] == "player-alpha-2" and b["handoff_occurred"] is True and t.monotonic() - t0 < 1.5, (b, t.monotonic() - t0))


def test_phase6_moderation_price_profile():
    reset()
    org, manager, viewer = login("organizer@nascon.test"), login("manager@nascon.test"), login("viewer@nascon.test")
    for _ in range(2):
        s, b, _ = call("POST", "/api/v1/chat/chat-match-m1/moderation", {"action": "kick", "user_id": "troll"}, org)
    check("moderator kick idempotent", s == 200 and b["kicked_users"] == ["troll"], b)
    s, b, _ = call("POST", "/api/v1/chat/chat-match-m1/moderation", {"action": "kick", "user_id": "x"}, viewer)
    check("viewer cannot moderate", s == 403, b)
    s, b, _ = call("POST", "/api/v1/chat/chat-match-m1/moderation", {"action": "kick", "user_id": "x"}, {"Authorization": "Bearer guest_anon_tok_7721"})
    check("guest cannot moderate", s == 403 and b["error"]["code"] == "GUEST_WRITE_FORBIDDEN", b)
    s, b, _ = call("POST", "/api/v1/variants/var-jersey-001-L/price", {"price_minor": 400000}, manager)
    check("manager reprices now", s == 201 and b["current_price_minor"] == 400000, b)
    s, b, _ = call("POST", "/api/v1/variants/var-jersey-001-L/price", {"price_minor": 380000, "effective_at": "2099-01-01T00:00:00Z"}, manager)
    check("future price scheduled", b["current_price_minor"] == 400000 and b["scheduled"][0]["price_minor"] == 380000, b)
    s, b, _ = call("POST", "/api/v1/variants/var-jersey-001-L/price", {"price_minor": 1}, viewer)
    check("viewer cannot reprice", s == 403, b)
    s, b, _ = call("POST", "/audit/v1/checkout", {"order_id": "o-price", "customer_id": "c", "items": [{"variant_id": "var-jersey-001-L", "quantity": 1}],
                                                  "discount_code": None, "payment": {"token": "tok_success"}})
    check("checkout uses effective price", s == 201 and b["total_minor"] == 400000, b.get("total_minor"))
    s, b, _ = call("POST", "/api/v1/inventory/var-jersey-001-L/restock", {"quantity": 3, "reason": "delivery"}, manager)
    s2, a, _ = call("GET", "/api/v1/inventory/var-jersey-001-L/audit", None, manager)
    check("restock + audit trail", s == 200 and b["stock"] == 7 and a["entries"][-1]["delta"] == 3, (b, a))
    s, b, _ = call("GET", "/api/v1/orders", None, manager)
    check("manager order list", s == 200 and any(o["order_id"] == "o-price" for o in b["orders"]), b)
    s, b, _ = call("GET", "/api/v1/athletes/player-alpha-1")
    check("athlete profile", s == 200 and b["club"]["club_id"] == "club-alpha-1" and b["career"]["played"] >= 1
          and any(f["match_id"] == "match-m1" for f in b["upcoming_fixtures"]), b)


if __name__ == "__main__":
    test_stream_keys()
    test_costream()
    test_qr()
    test_guest()
    test_moderation()
    test_metrics_privacy()
    test_phase6_costream_controls()
    test_phase6_moderation_price_profile()
    reset()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
