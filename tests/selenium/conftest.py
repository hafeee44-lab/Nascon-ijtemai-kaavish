"""Selenium Grid 4 fixtures (spec §6.2). Run: pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml

GRID_URL      Selenium hub (default http://localhost:4444)
APP_URL       base URL as seen *from the browser nodes* (compose network: http://api:8080;
              API on the host: http://host.docker.internal:8080)
API_URL       base URL as seen from this test process (default http://localhost:8080)
"""
import json
import os
import urllib.request

import pytest
from selenium import webdriver

GRID_URL = os.environ.get("GRID_URL", "http://localhost:4444")
APP_URL = os.environ.get("APP_URL", "http://api:8080").rstrip("/")
API_URL = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")


def api(method, path, body=None):
    req = urllib.request.Request(API_URL + path, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"null")


def _options(browser):
    if browser == "firefox":
        o = webdriver.FirefoxOptions()
    else:
        o = webdriver.ChromeOptions()
        o.add_argument("--no-sandbox")
        o.add_argument("--disable-dev-shm-usage")
    o.add_argument("--headless=new" if browser == "chrome" else "-headless")
    o.set_capability("se:name", f"nascon-guest-{browser}")
    return o


@pytest.fixture(params=["chrome", "firefox"])
def driver(request):
    d = webdriver.Remote(command_executor=GRID_URL, options=_options(request.param))
    d.set_window_size(1280, 900)
    yield d
    d.quit()
