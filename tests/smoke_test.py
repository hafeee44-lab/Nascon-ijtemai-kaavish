"""End-to-end smoke tests against a running stack (python3 tests/smoke_test.py).

Mirrors the grader's style: reset, call /audit/v1/*, compare fields literally.
Requires DAY1_SALT in the environment to match the running stack.
"""
import hashlib
import hmac
import json
import os
import sys
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
SALT = os.environ.get("DAY1_SALT", "demo-salt")
FAILS = []


def call(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"null"), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except Exception:
            return e.code, raw, dict(e.headers)


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign(id_, payload):
    return hmac.new(SALT.encode(), (id_ + "|" + canonical(payload)).encode(), hashlib.sha256).hexdigest()


def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {info}"))
    if not cond:
        FAILS.append(name)


def ev(eid, mid, typ, payload=None):
    return call("POST", "/audit/v1/events", {"event_id": eid, "match_id": mid, "type": typ, "payload": payload or {}})


def test_scoring():
    call("POST", "/audit/v1/reset", {})
    s, b, _ = ev("e1", "m1", "match_init", {"sport_id": "football", "home_team_id": "t1", "away_team_id": "t2"})
    check("init 201", s == 201 and b["sequence"] == 1, b)
    s, b, _ = ev("e1", "m1", "match_init", {"sport_id": "football", "home_team_id": "t1", "away_team_id": "t2"})
    check("idempotent replay 200", s == 200 and b["sequence"] == 1, b)
    s, b, _ = ev("e1", "m1", "match_init", {"sport_id": "football", "home_team_id": "t1", "away_team_id": "t3"})
    check("duplicate event id 409", s == 409 and b["error"]["code"] == "DUPLICATE_EVENT_ID", b)
    s, b, _ = ev("e2", "m1", "score", {"team_id": "t1", "event_type": "goal"})
    check("score before start 409", s == 409 and b["error"]["code"] == "MATCH_NOT_IN_PROGRESS", b)
    ev("e3", "m1", "match_start")
    s, b, _ = ev("e4", "m1", "score", {"team_id": "t1", "event_type": "goal"})
    check("score signature", s == 201 and b["signature"] == sign("e4", {"team_id": "t1", "event_type": "goal"}), b)
    s, b, _ = ev("e5", "m1", "score", {"team_id": "t1", "event_type": "wicket"})
    check("unknown event type 400", s == 400 and b["error"]["code"] == "UNKNOWN_EVENT_TYPE", b)
    ev("e6", "m1", "score", {"team_id": "t2", "event_type": "goal"})
    ev("e7", "m1", "discipline", {"team_id": "t2", "points": -1})
    ev("e8", "m1", "match_end")
    s, b, _ = ev("e9", "m1", "compensation", {"compensates": "e6", "reason": "offside"})
    check("compensation after completion 201", s == 201, b)
    s, b, _ = ev("e10", "m1", "compensation", {"compensates": "e6", "reason": "again"})
    check("double compensation 409", s == 409 and b["error"]["code"] == "INVALID_COMPENSATION", b)
    s, b, _ = call("GET", "/audit/v1/score/m1")
    check("score projection", s == 200 and b["home"]["score"] == 1 and b["away"]["score"] == 0 and b["outcome"] == "home_win"
          and b["away"]["fair_play"] == -1 and b["version"] == 7, b)
    e6 = [e for e in b["events"] if e["event_id"] == "e6"][0]
    check("compensated flags", e6["compensated"] and e6["compensated_by"] == "e9", e6)

    # mystery sport (round model) + series limit
    s, b, _ = call("POST", "/audit/v1/sports", {"sport_id": "chess_x", "name": "Chess X", "scoring_model": "round",
                                               "periods": {"best_of": 3}, "scoring_events": {"map_win": {"rounds": 1}},
                                               "draw_allowed": False, "overtime": {"policy": "none"},
                                               "roster": {"min_squad_size": 1, "max_squad_size": 3, "required_positions": {}}})
    check("mystery sport 201", s == 201, b)
    s, b, _ = call("POST", "/audit/v1/sports", {"sport_id": "x'; DROP TABLE sports;--"})
    check("sql-ish sport id 400", s == 400 and b["error"]["code"] == "VALIDATION_ERROR", b)
    ev("r1", "mr", "match_init", {"sport_id": "chess_x", "home_team_id": "a", "away_team_id": "b"})
    ev("r2", "mr", "match_start")
    ev("r3", "mr", "score", {"team_id": "a", "event_type": "map_win"})
    ev("r4", "mr", "score", {"team_id": "a", "event_type": "map_win"})
    s, b, _ = ev("r5", "mr", "score", {"team_id": "b", "event_type": "map_win"})
    check("series decided 409", s == 409 and b["error"]["code"] == "SERIES_ALREADY_DECIDED", b)


def test_standings_three_way():
    call("POST", "/audit/v1/reset", {})
    fixtures = [("m1", "t1", "t2"), ("m2", "t2", "t3"), ("m3", "t3", "t1"), ("m4", "t1", "t4"), ("m5", "t2", "t4"), ("m6", "t3", "t4")]
    s, b, _ = call("POST", "/audit/v1/leagues", {"league_id": "lg-1", "sport_id": "football", "teams": ["t1", "t2", "t3", "t4"],
                                                "fixtures": [{"match_id": m, "home": h, "away": a} for m, h, a in fixtures],
                                                "qualification": {"spots": 2}})
    check("league 201", s == 201 and b["fixture_count"] == 6, b)
    n = [0]

    def play(mid, home, away, hg, ag):
        ev(f"{mid}-s", mid, "match_start")
        for t, g in ((home, hg), (away, ag)):
            for _ in range(g):
                n[0] += 1
                ev(f"g{n[0]}", mid, "score", {"team_id": t, "event_type": "goal"})
        ev(f"{mid}-e", mid, "match_end")

    play("m1", "t1", "t2", 2, 0)
    play("m2", "t2", "t3", 3, 1)
    play("m3", "t3", "t1", 1, 0)
    play("m4", "t1", "t4", 1, 0)
    play("m5", "t2", "t4", 1, 0)
    play("m6", "t3", "t4", 1, 0)
    s, b, _ = call("GET", "/audit/v1/standings/lg-1")
    order = [r["team_id"] for r in b["table"]]
    # t1,t2,t3 all 6 pts; h2h each 3 pts; h2h diff: t1 +1, t2 0, t3 -1
    check("3-way h2h ordering", order == ["t1", "t2", "t3", "t4"], b["table"])
    check("resolved_by h2h_diff", b["table"][0]["resolved_by"] == "h2h_diff", b["table"][0])
    check("t4 eliminated", b["table"][3]["status"] == "eliminated", b["table"][3])
    check("h2h matrix", b["h2h"]["t1"]["t2"] == {"played": 1, "points": 3, "scored": 2, "conceded": 0}, b["h2h"]["t1"])


def test_checkout_burst():
    import base64
    import threading

    call("POST", "/audit/v1/reset", {"stock": {"var-jersey-001-M": 1}})
    barrier = threading.Barrier(20)
    results = []

    def buy(i):
        barrier.wait()
        results.append(call("POST", "/audit/v1/checkout", {
            "order_id": f"ord-{i}", "customer_id": "cust-1", "items": [{"variant_id": "var-jersey-001-M", "quantity": 1}],
            "discount_code": None, "payment": {"token": "tok_success"}}))

    threads = [threading.Thread(target=buy, args=(i,)) for i in range(20)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    codes = sorted(r[0] for r in results)
    check("burst: one 201, nineteen 409", codes == [201] + [409] * 19, codes)
    s, b, _ = call("GET", "/audit/v1/inventory/var-jersey-001-M")
    check("burst: stock 0 reserved 0", b == {"variant_id": "var-jersey-001-M", "stock": 0, "reserved": 0}, b)
    ok = [r[1] for r in results if r[0] == 201][0]
    check("receipt signature", ok["receipt"]["signature"] == sign(ok["order_id"], ok["receipt"]["payload"]), ok["receipt"]["payload"])
    pdf = base64.b64decode(ok["receipt"]["pdf_base64"])
    check("receipt is a PDF", pdf.startswith(b"%PDF"), pdf[:8])

    call("POST", "/audit/v1/reset", {})
    s, b, _ = call("POST", "/audit/v1/checkout", {"order_id": "o-d", "customer_id": "c\"<script>", "items": [{"variant_id": "var-jersey-001-L", "quantity": 2}],
                                                 "discount_code": "WELCOME10", "payment": {"token": "tok_declined"}})
    check("declined 402", s == 402 and b["error"]["code"] == "PAYMENT_DECLINED", b)
    s, b, _ = call("GET", "/audit/v1/inventory/var-jersey-001-L")
    check("declined releases stock", b["stock"] == 5 and b["reserved"] == 0, b)
    body = {"order_id": "o-ok", "customer_id": "c\"<script>", "items": [{"variant_id": "var-jersey-001-L", "quantity": 2}],
            "discount_code": "WELCOME10", "payment": {"token": "tok_success"}}
    s, b, _ = call("POST", "/audit/v1/checkout", body)
    check("discount math", s == 201 and b["subtotal_minor"] == 900000 and b["discount_minor"] == 90000 and b["total_minor"] == 810000, b)
    s2, b2, _ = call("POST", "/audit/v1/checkout", body)
    check("checkout replay 200", s2 == 200 and b2 == b, (s2,))
    s, b, _ = call("POST", "/audit/v1/checkout", {**body, "items": [{"variant_id": "var-jersey-001-L", "quantity": 1}]})
    check("duplicate order id 409", s == 409 and b["error"]["code"] == "DUPLICATE_ORDER_ID", b)
    s, b, _ = call("POST", "/audit/v1/checkout", {**body, "order_id": "o-x", "discount_code": "NOPE"})
    check("bad discount 400", s == 400 and b["error"]["code"] == "INVALID_DISCOUNT_CODE", b)


def test_rbac():
    call("POST", "/audit/v1/reset", {})
    s, m, _ = call("POST", "/audit/v1/rbac-matrix")
    t, c = m["tokens"], m["context"]
    roles = ["super_admin", "league_organizer", "club_manager", "player", "viewer"]
    A, D = 200, 403
    cases = [
        ("POST", "/audit/v1/rbac/tenants", [A, D, D, D, D]),
        ("POST", f"/audit/v1/rbac/leagues/{c['own_league_id']}/fixtures", [A, A, D, D, D]),
        ("POST", f"/audit/v1/rbac/leagues/{c['other_league_id']}/fixtures", [A, D, D, D, D]),
        ("POST", f"/audit/v1/rbac/leagues/{c['foreign_league_id']}/fixtures", [A, D, D, D, D]),
        ("POST", f"/audit/v1/rbac/clubs/{c['own_club_id']}/roster", [A, D, A, D, D]),
        ("POST", f"/audit/v1/rbac/clubs/{c['other_club_id']}/products", [A, D, D, D, D]),
        ("POST", f"/audit/v1/rbac/clubs/{c['foreign_club_id']}/roster", [A, D, D, D, D]),
        ("PATCH", f"/audit/v1/rbac/players/{c['own_player_id']}", [A, D, A, A, D]),
        ("PATCH", f"/audit/v1/rbac/players/{c['other_player_id']}", [A, D, D, D, D]),
        ("PATCH", f"/audit/v1/rbac/players/{c['foreign_player_id']}", [A, D, D, D, D]),
        ("GET", f"/audit/v1/rbac/clubs/{c['own_club_id']}", [A, A, A, A, A]),
        ("GET", f"/audit/v1/rbac/clubs/{c['other_club_id']}", [A, A, A, A, A]),
        ("GET", f"/audit/v1/rbac/clubs/{c['foreign_club_id']}", [A, D, D, D, D]),
        ("GET", "/audit/v1/rbac/platform/config", [A, D, D, D, D]),
    ]
    bad = []
    for method, path, expect in cases:
        for role, want in zip(roles, expect):
            s, b, _ = call(method, path, {} if method != "GET" else None, {"Authorization": f"Bearer {t[role]}"})
            if s != want or (s == 403 and b["error"]["code"] != "FORBIDDEN"):
                bad.append((method, path, role, s))
    check("rbac matrix (70 cells)", not bad, bad)
    s, b, _ = call("GET", "/audit/v1/rbac/platform/config")
    check("no token 401", s == 401 and b["error"]["code"] == "UNAUTHENTICATED", b)
    head, payload, sig = t["super_admin"].split(".")
    s, _, _ = call("GET", "/audit/v1/rbac/platform/config", None, {"Authorization": f"Bearer {head}.{payload}.{sig[:-2]}xx"})
    check("tampered 401", s == 401, s)
    none_head = base64url(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    s, _, _ = call("GET", "/audit/v1/rbac/platform/config", None, {"Authorization": f"Bearer {none_head}.{payload}."})
    check("alg none 401", s == 401, s)
    s, b, _ = call("POST", "/api/v1/auth/login", {"email": "manager@nascon.test", "password": "Nascon@26"})
    check("demo login", s == 200 and b["user"]["role"] == "club_manager", b)


def test_roster_and_sync():
    call("POST", "/audit/v1/reset", {})
    setup = {"league": {"league_id": "lg-r1", "tenant_id": "tenant-alpha", "sport_id": "football",
                        "transfer_window": {"open": "2026-09-01", "close": "2026-09-30"}, "max_squad_size": 3, "required_positions": {"gk": 1}},
             "squads": [{"squad_id": "sq-a", "club_id": "club-a", "tenant_id": "tenant-alpha", "name": "A"},
                        {"squad_id": "sq-b", "club_id": "club-b", "tenant_id": "tenant-alpha", "name": "B"},
                        {"squad_id": "sq-x", "club_id": "club-x", "tenant_id": "tenant-beta", "name": "X"}],
             "players": [{"player_id": "p1", "name": "Ali", "position": "gk", "squad_id": "sq-a", "role": "captain"},
                         {"player_id": "p2", "name": "Bilal", "position": "df", "squad_id": "sq-a", "role": "starter"},
                         {"player_id": "p3", "name": "Cam", "position": "df", "squad_id": "sq-b", "role": "starter"}],
             "matches_in_progress": [{"match_id": "m-live", "home_squad_id": "sq-a", "away_squad_id": "sq-b"}]}
    s, b, _ = call("POST", "/audit/v1/roster/setup", setup)
    check("roster setup", s == 201 and b["squad_counts"] == {"sq-a": 2, "sq-b": 1, "sq-x": 0}, b)

    def tr(rid, **kw):
        body = {"request_id": rid, "league_id": "lg-r1", "player_id": "p2", "type": "transfer", "from_squad_id": "sq-a",
                "to_squad_id": "sq-b", "effective_date": "2026-09-30", "loan_end_date": None, "reason": "r", "requested_by": "u1"}
        body.update(kw)
        return call("POST", "/audit/v1/roster/transfer", body)

    s, b, _ = tr("t0", to_squad_id="sq-x")
    check("cross tenant 409", s == 409 and b["error"]["code"] == "CROSS_TENANT_TRANSFER", b)
    s, b, _ = tr("t1", effective_date="2026-10-01")
    check("window closed 409", s == 409 and b["error"]["code"] == "TRANSFER_WINDOW_CLOSED", b)
    s, b, _ = tr("t2", player_id="p1")
    check("min position 409", s == 409 and b["error"]["code"] == "MIN_POSITION_VIOLATION", b)
    s, b, _ = tr("t3", type="loan", loan_end_date="2026-12-31")
    check("loan deferred (last day, live match)", s == 201 and b["state"] == "deferred_until_match_end" and b["blocking_match_id"] == "m-live"
          and b["registration"]["parent_squad_id"] == "sq-a", b)
    s2, b2, _ = tr("t3", type="loan", loan_end_date="2026-12-31")
    check("transfer replay 200", s2 == 200 and b2 == b, s2)
    s, b, _ = tr("t4", from_squad_id="sq-b", to_squad_id="sq-a", effective_date="2026-09-30")
    check("on loan 409", s == 409 and b["error"]["code"] == "PLAYER_ON_LOAN", b)
    s, b, _ = call("GET", "/audit/v1/roster/history/p2?as_of=2027-01-05")
    s, b, _ = call("GET", "/audit/v1/roster/history/p2?as_of=2027-01-05")
    acts = [h["action"] for h in b["history"]]
    check("loan auto-return once", s == 200 and acts == ["loan", "loan_return"] and b["current_squad_id"] == "sq-a", b)

    # offline sync
    ev("o1", "om", "match_init", {"sport_id": "football", "home_team_id": "t1", "away_team_id": "t2"})
    ev("o2", "om", "match_start")
    body = {"device_id": "dev-1", "actions": [
        {"action_id": "a2", "type": "roster_transfer", "queued_at": "2026-10-17T11:01:00Z", "base_version": 0,
         "payload": {"request_id": "tr-x", "league_id": "lg-r1", "player_id": "p3", "type": "transfer", "from_squad_id": "sq-b",
                     "to_squad_id": "sq-a", "effective_date": "2026-09-15", "loan_end_date": None, "reason": "x", "requested_by": "u"}},
        {"action_id": "a1", "type": "score_event", "queued_at": "2026-10-17T11:00:00Z", "base_version": 1,
         "payload": {"event_id": "o3", "match_id": "om", "type": "score", "payload": {"team_id": "t1", "event_type": "goal"}}},
        {"action_id": "a3", "type": "score_event", "queued_at": "2026-10-17T11:02:00Z", "base_version": 9,
         "payload": {"event_id": "o4", "match_id": "om", "type": "score", "payload": {"team_id": "t1", "event_type": "goal"}}}]}
    s, b, _ = call("POST", "/audit/v1/offline-sync", body)
    r = {x["action_id"]: x for x in b["results"]}
    check("sync rebased score", r["a1"]["status"] == "applied" and r["a1"]["resolution"] == "rebased_append" and r["a1"]["server_version"] == 3
          and r["a1"]["processed_order"] == 1 and r["a1"]["signature"] == sign("o3", {"team_id": "t1", "event_type": "goal"}), r["a1"])
    check("sync roster applied", r["a2"]["status"] == "applied" and r["a2"]["processed_order"] == 2, r["a2"])
    check("sync invalid base version", r["a3"]["error_code"] == "INVALID_BASE_VERSION" and r["a3"]["resolution"] == "server_wins", r["a3"])
    check("sync results in request order", [x["action_id"] for x in b["results"]] == ["a2", "a1", "a3"], b["results"])
    s, b, _ = call("POST", "/audit/v1/offline-sync", body)
    check("sync resend all duplicate", all(x["status"] == "duplicate" for x in b["results"]), b)


def base64url(raw):
    import base64
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def test_rate_limit_and_size():
    import time
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(30) as ex:
        res = list(ex.map(lambda _: call("GET", "/api/v1/ping"), range(150)))
    n429 = [r for r in res if r[0] == 429]
    check("ping rate limited (>=40 x 429 with Retry-After)", len(n429) >= 40 and all("Retry-After" in r[2] for r in n429), len(n429))
    time.sleep(11)
    s, b, _ = call("GET", "/api/v1/ping")
    check("ping recovers after 11 s", s == 200 and b == {"pong": True}, (s, b))
    s, b, _ = call("POST", "/audit/v1/sports", {"pad": "x" * (1024 * 1024 + 10)})
    check("413 on >1MB", s == 413 and b["error"]["code"] == "PAYLOAD_TOO_LARGE", (s, b))


if __name__ == "__main__":
    test_scoring()
    test_standings_three_way()
    test_checkout_burst()
    test_rbac()
    test_roster_and_sync()
    if "--fast" not in sys.argv:
        test_rate_limit_and_size()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
