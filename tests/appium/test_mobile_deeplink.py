"""Appium 2 mobile suite (spec §6.3): deep links + cross-surface chat.

Run: pytest tests/appium --junitxml=tests/reports/appium-report.xml
APPIUM_URL (default http://localhost:4723), ANDROID_UDID (default: first adb device),
API_URL (default http://localhost:8080), GRID_URL / APP_URL for the Selenium half of the cross-surface test.
"""
import json
import os
import subprocess
import time
import urllib.request
import uuid

import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.webdriver.common.appiumby import AppiumBy

APPIUM_URL = os.environ.get("APPIUM_URL", "http://localhost:4723")
API_URL = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")
PKG = "com.nasconapp"
ADB = os.environ.get("ADB", "adb")


def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"null")


def udid():
    if os.environ.get("ANDROID_UDID"):
        return os.environ["ANDROID_UDID"]
    out = subprocess.run([ADB, "devices"], capture_output=True, text=True).stdout.splitlines()[1:]
    devices = [l.split()[0] for l in out if l.strip().endswith("device")]
    if not devices:
        pytest.skip("no Android device connected")
    return devices[0]


def deep_link(url, device):
    # Exactly the command the desk auditor fires (spec §6.3).
    return subprocess.run([ADB, "-s", device, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", url],
                          capture_output=True, text=True, timeout=20).stdout


@pytest.fixture(scope="module")
def device():
    return udid()


@pytest.fixture(scope="module")
def driver(device):
    o = UiAutomator2Options()
    o.platform_name = "Android"
    o.udid = device
    o.app_package = PKG
    o.app_activity = ".MainActivity"
    o.no_reset = True
    o.set_capability("appium:newCommandTimeout", 120)
    o.set_capability("appium:adbExecTimeout", 60000)
    d = webdriver.Remote(APPIUM_URL, options=o)
    yield d
    d.quit()


def wait_for(driver, acc_id, timeout=6.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        found = driver.find_elements(AppiumBy.ACCESSIBILITY_ID, acc_id)
        if found:
            return found[0]
        time.sleep(0.2)
    raise AssertionError(f"element '{acc_id}' not shown within {timeout}s")


def test_appium_server_ready():
    status = http("GET", f"{APPIUM_URL}/status")
    assert status["value"]["ready"] is True


def test_deeplink_opens_match_live(driver, device):
    t0 = time.monotonic()
    out = deep_link("nascon://entity/match-m1", device)
    assert "Error" not in out, out
    wait_for(driver, "match-live-screen")
    assert driver.current_package == PKG
    assert time.monotonic() - t0 < 6.0  # app is foregrounded within the 2 s intent budget + render


def test_deeplink_opens_costream(driver, device):
    http("POST", f"{API_URL}/audit/v1/costream/session", {
        "session_id": "cs-session-101", "host_player_id": "player-alpha-1",
        "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"], "layout": "grid_4"})
    deep_link("nascon://stream/cs-session-101", device)
    wait_for(driver, "costream-screen")
    assert driver.current_package == PKG


def test_cross_surface_chat_sync(driver, device):
    """Mobile joins cs-session-101 and posts; a Selenium Grid browser on /web/costream sees it < 3 s."""
    from selenium import webdriver as sw
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait

    grid = os.environ.get("GRID_URL", "http://localhost:4444")
    app_url = os.environ.get("APP_URL", "http://api:8080").rstrip("/")
    opts = sw.ChromeOptions()
    opts.add_argument("--headless=new")
    browser = sw.Remote(command_executor=grid, options=opts)
    try:
        browser.get(f"{app_url}/web/costream/cs-session-101")
        WebDriverWait(browser, 5).until(lambda b: b.find_element(By.CSS_SELECTOR, '[data-testid="chat-message-list"]'))
        time.sleep(0.5)
        deep_link("nascon://stream/cs-session-101", device)
        wait_for(driver, "costream-screen")
        text = f"mobile cheer {uuid.uuid4().hex[:6]}"
        field = wait_for(driver, "costream-chat-input")
        field.send_keys(text)
        wait_for(driver, "costream-chat-send").click()
        t0 = time.monotonic()
        WebDriverWait(browser, 3, poll_frequency=0.1).until(
            lambda b: text in b.find_element(By.CSS_SELECTOR, '[data-testid="chat-message-list"]').text)
        assert time.monotonic() - t0 < 3.0
    finally:
        browser.quit()
