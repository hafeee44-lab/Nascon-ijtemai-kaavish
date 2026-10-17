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


if __name__ == "__main__":
    test_scoring()
    test_standings_three_way()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
