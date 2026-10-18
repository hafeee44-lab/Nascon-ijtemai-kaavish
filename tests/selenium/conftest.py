"""Shared fixtures for the Selenium Grid 4 suite (spec §6.2).

Two vantage points matter here:
  BASE_URL     how the browsers *inside the grid* reach the API (compose service name by default)
  API_URL      how this test runner reaches the API (to reset state and post score events)
"""
import json
import os
import urllib.error
import urllib.request

import pytest
from selenium import webdriver

SELENIUM_URL = os.environ.get("SELENIUM_URL", "http://localhost:4444")
BASE_URL = os.environ.get("BASE_URL", "http://api:8080").rstrip("/")
API_URL = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")
BROWSERS = [b.strip() for b in os.environ.get("BROWSERS", "chrome,firefox").split(",") if b.strip()]

COSTREAM = {
    "session_id": "cs-session-101",
    "host_player_id": "player-alpha-1",
    "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"],
    "layout": "grid_4",
    "simulate_host_drop": False,
}


def call(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API_URL + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def pytest_configure(config):
    # Runs once on the xdist controller, before any worker starts, so every worker sees one clean baseline.
    if hasattr(config, "workerinput") or os.environ.get("SKIP_RESET") == "1":
        return
    try:
        call("POST", "/audit/v1/reset")
        call("POST", "/audit/v1/costream/session", COSTREAM)
    except OSError as e:  # surfaced per-test instead of aborting collection
        print(f"[selenium suite] could not seed baseline via {API_URL}: {e}")


def _options(name):
    if name == "chrome":
        o = webdriver.ChromeOptions()
        o.add_argument("--headless=new")
        o.add_argument("--window-size=412,915")
        return o
    if name == "firefox":
        o = webdriver.FirefoxOptions()
        o.add_argument("-headless")
        return o
    raise ValueError(f"unsupported browser {name!r}")


@pytest.fixture(params=BROWSERS)
def driver(request):
    d = webdriver.Remote(command_executor=SELENIUM_URL, options=_options(request.param))
    d.set_page_load_timeout(20)
    if request.param == "firefox":
        d.set_window_size(412, 915)
    yield d
    d.quit()


@pytest.fixture
def base_url():
    return BASE_URL


@pytest.fixture
def api():
    return call
