"""Fixtures for the Appium 2 suite (spec §6.3).

Desk setup: Appium 2 on :4723 with the uiautomator2 driver, one Android device on `adb`,
the app installed, and `adb reverse tcp:8080 tcp:8080` so the phone reaches the API.
"""
import json
import os
import shutil
import subprocess
import urllib.request

import pytest

APPIUM_URL = os.environ.get("APPIUM_URL", "http://localhost:4723").rstrip("/")
APP_PACKAGE = os.environ.get("APP_PACKAGE", "com.nasconapp")
APP_ACTIVITY = os.environ.get("APP_ACTIVITY", ".MainActivity")
SELENIUM_URL = os.environ.get("SELENIUM_URL", "http://localhost:4444")
BASE_URL = os.environ.get("BASE_URL", "http://api:8080").rstrip("/")
ADB = os.environ.get("ADB", shutil.which("adb") or "adb")


def adb(*args, timeout=15):
    return subprocess.run([ADB, *args], capture_output=True, text=True, timeout=timeout).stdout


def appium_status():
    with urllib.request.urlopen(f"{APPIUM_URL}/status", timeout=5) as r:
        return json.loads(r.read())


@pytest.fixture(scope="session")
def device():
    if not shutil.which(ADB) and not os.path.exists(ADB):
        pytest.skip("adb not available on this runner")
    lines = [l for l in adb("devices").splitlines()[1:] if l.strip().endswith("device")]
    if not lines:
        pytest.skip("no Android device attached (connect the desk phone with USB debugging)")
    if APP_PACKAGE not in adb("shell", "pm", "list", "packages", APP_PACKAGE):
        pytest.skip(f"{APP_PACKAGE} is not installed on the device")
    return lines[0].split()[0]


@pytest.fixture(scope="session")
def mobile(device):
    try:
        from appium import webdriver as appium_webdriver
        from appium.options.android import UiAutomator2Options
    except ImportError:
        pytest.skip("Appium-Python-Client not installed (pip install -r tests/requirements.txt)")
    opts = UiAutomator2Options()
    opts.platform_name = "Android"
    opts.automation_name = "UiAutomator2"
    opts.udid = device
    opts.set_capability("appium:appPackage", APP_PACKAGE)
    opts.set_capability("appium:appActivity", APP_ACTIVITY)
    opts.set_capability("appium:noReset", True)
    opts.set_capability("appium:autoLaunch", False)  # the deep link is what launches the app
    opts.set_capability("appium:newCommandTimeout", 180)
    d = appium_webdriver.Remote(APPIUM_URL, options=opts)
    yield d
    d.quit()
