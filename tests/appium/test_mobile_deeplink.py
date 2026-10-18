"""Native deep-link and cross-surface checks (spec §6.3).

Run:  pytest tests/appium/ --junitxml=tests/reports/appium-report.xml

Screen contract the app must expose (React Native testID -> resource-id, accessibilityLabel -> content-desc):
    screen-match-live      root of the Match Live screen opened by nascon://entity/match-*
    screen-costream        root of the Co-stream screen opened by nascon://stream/cs-session-*
    costream-chat-input    chat text field on the Co-stream screen
    costream-chat-send     chat send button on the Co-stream screen
"""
import re
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from conftest import APP_PACKAGE, BASE_URL, SELENIUM_URL, adb, appium_status

MANIFEST = Path(__file__).resolve().parents[2] / "mobile/android/app/src/main/AndroidManifest.xml"
ANDROID = "{http://schemas.android.com/apk/res/android}"
DEEP_LINKS = [
    ("nascon://entity/match-m1", "screen-match-live"),
    ("nascon://stream/cs-session-101", "screen-costream"),
]


def find_any(driver, key, timeout):
    """Locate by resource-id or content-desc, so either RN testID or accessibilityLabel satisfies the contract."""
    from selenium.webdriver.support.ui import WebDriverWait
    from appium.webdriver.common.appiumby import AppiumBy
    xpath = f"//*[@resource-id='{key}' or @resource-id='{APP_PACKAGE}:id/{key}' or @content-desc='{key}']"
    return WebDriverWait(driver, timeout, 0.1).until(lambda d: d.find_element(AppiumBy.XPATH, xpath))


def fire(uri):
    return adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", uri)


def test_appium_server_ready():
    status = appium_status()
    assert status.get("value", {}).get("ready") is True, status


def test_manifest_declares_nascon_scheme():
    root = ET.parse(MANIFEST).getroot()
    for f in root.iter("intent-filter"):
        actions = {a.get(f"{ANDROID}name") for a in f.findall("action")}
        cats = {c.get(f"{ANDROID}name") for c in f.findall("category")}
        schemes = {d.get(f"{ANDROID}scheme") for d in f.findall("data")}
        if ("android.intent.action.VIEW" in actions and "nascon" in schemes
                and {"android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"} <= cats):
            return
    pytest.fail("AndroidManifest.xml has no VIEW + DEFAULT + BROWSABLE intent-filter for scheme 'nascon'")


@pytest.mark.parametrize("uri,_screen", DEEP_LINKS)
def test_deeplink_foregrounds_app_within_2s(device, uri, _screen):
    out = fire(uri)
    assert "Status: ok" in out, out
    total = re.search(r"TotalTime:\s*(\d+)", out)
    if total:
        assert int(total.group(1)) <= 2000, f"{uri} took {total.group(1)} ms to foreground (limit 2000)"
    focus = adb("shell", "dumpsys", "window")
    assert re.search(rf"mCurrentFocus=.*{re.escape(APP_PACKAGE)}", focus), f"{APP_PACKAGE} is not in the foreground"


@pytest.mark.parametrize("uri,screen", DEEP_LINKS)
def test_deeplink_lands_on_screen_not_login(mobile, uri, screen):
    fire(uri)
    find_any(mobile, screen, 2)  # opened directly, without stopping on the login screen


def test_cross_surface_costream_chat_within_3s(mobile):
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from appium.webdriver.common.appiumby import AppiumBy

    opts = webdriver.ChromeOptions()
    opts.add_argument("--headless=new")
    web = webdriver.Remote(command_executor=SELENIUM_URL, options=opts)
    try:
        web.get(f"{BASE_URL}/web/costream/cs-session-101")
        WebDriverWait(web, 5).until(lambda d: d.find_element(By.CSS_SELECTOR, '[data-testid="chat-message-list"]'))

        fire("nascon://stream/cs-session-101")
        sign_in = mobile.find_elements(AppiumBy.XPATH, "//*[@resource-id='costream-sign-in' or @resource-id='com.nasconapp:id/costream-sign-in' or @content-desc='costream-sign-in']")
        if sign_in:
            sign_in[0].click()
            find_any(mobile, "login-email", 3).send_keys("player@nascon.test")
            find_any(mobile, "login-password", 3).send_keys("Nascon@26")
            find_any(mobile, "Sign in →", 3).click()
            find_any(mobile, "screen-costream", 5)

        marker = f"cross-surface {uuid.uuid4().hex[:6]}"
        find_any(mobile, "costream-chat-input", 3).send_keys(marker)
        find_any(mobile, "costream-chat-send", 2).click()
        sent = time.monotonic()

        WebDriverWait(web, 3, 0.05).until(
            lambda d: marker in d.find_element(By.CSS_SELECTOR, '[data-testid="chat-message-list"]').text)
        assert time.monotonic() - sent <= 3.0
    finally:
        web.quit()
