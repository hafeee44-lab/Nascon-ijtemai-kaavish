"""Guest Web Player — Selenium Grid 4 suite (spec §6.2.3, NFR-8).

Run (parallel across >= 3 grid sessions):
    pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml
"""
import os
import time
import uuid

import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

SCORE_SLA_MS = int(os.environ.get("SCORE_SLA_MS", "500"))

REQUIRED_TESTIDS = [
    "guest-video-player", "live-score-banner", "pinned-merch-card", "add-to-guest-cart-btn",
    "guest-cart-count", "chat-message-list", "chat-input-field", "chat-send-btn", "progressive-auth-modal",
]


def tid(name):
    return By.CSS_SELECTOR, f'[data-testid="{name}"]'


def visible(driver, name, timeout):
    return WebDriverWait(driver, timeout, poll_frequency=0.05).until(EC.visibility_of_element_located(tid(name)))


def text_of(driver, name):
    return driver.find_element(*tid(name)).text.strip()


def test_1_qr_resolution_zero_friction_load(driver, base_url):
    started = time.monotonic()
    driver.get(f"{base_url}/q/m1-live")
    WebDriverWait(driver, 3, 0.05).until(lambda d: d.current_url.split("?")[0].endswith("/web/matches/match-m1/live"))
    visible(driver, "guest-video-player", 3)
    banner = visible(driver, "live-score-banner", 3)
    elapsed = time.monotonic() - started
    assert elapsed <= 3.0, f"player + score took {elapsed:.2f}s (limit 3s)"
    assert banner.text.strip(), "live-score-banner rendered empty"
    modals = driver.find_elements(*tid("progressive-auth-modal"))
    assert not any(m.is_displayed() for m in modals), "no login wall may appear on first load"


def test_2_guest_write_block_opens_progressive_modal(driver, base_url):
    driver.get(f"{base_url}/web/matches/match-m1/live")
    field = visible(driver, "chat-input-field", 5)
    marker = f"guest-probe-{uuid.uuid4().hex[:8]}"
    field.send_keys(marker)
    driver.find_element(*tid("chat-send-btn")).click()
    visible(driver, "progressive-auth-modal", 3)
    time.sleep(0.5)  # give an over-optimistic UI the chance to append before asserting it did not
    assert marker not in text_of(driver, "chat-message-list"), "guest message must not be appended"


def test_3_guest_cart_staging_and_realtime_score(driver, base_url, api):
    driver.get(f"{base_url}/web/matches/match-m1/live")
    visible(driver, "guest-cart-count", 5)
    assert text_of(driver, "guest-cart-count") == "0"
    driver.find_element(*tid("add-to-guest-cart-btn")).click()
    WebDriverWait(driver, 3, 0.05).until(lambda d: text_of(d, "guest-cart-count") == "1")

    visible(driver, "live-score-banner", 3)
    time.sleep(0.5)  # let the live subscription settle before firing the event
    before = text_of(driver, "live-score-banner")
    status, body = api("POST", "/audit/v1/events", {
        "event_id": f"sel-{uuid.uuid4().hex[:12]}", "match_id": "match-m1", "type": "score",
        "payload": {"team_id": "club-alpha-1", "event_type": "goal"},
    })
    assert status in (200, 201), f"score event rejected: {status} {body}"
    fired = time.monotonic()
    WebDriverWait(driver, max(SCORE_SLA_MS / 1000 * 4, 2), 0.02).until(lambda d: text_of(d, "live-score-banner") != before)
    took_ms = (time.monotonic() - fired) * 1000
    assert took_ms < SCORE_SLA_MS, f"banner updated in {took_ms:.0f} ms (limit {SCORE_SLA_MS} ms)"


@pytest.mark.parametrize("path", ["/web/matches/match-m1/live", "/web/costream/cs-session-101"])
def test_contract_all_nine_testids_present(driver, base_url, path):
    driver.get(base_url + path)
    WebDriverWait(driver, 5).until(EC.presence_of_element_located(tid("guest-video-player")))
    missing = [n for n in REQUIRED_TESTIDS if not driver.find_elements(*tid(n))]
    assert not missing, f"{path} is missing data-testid(s): {missing}"


def test_nfr8_touch_targets_at_least_48px(driver, base_url):
    driver.get(f"{base_url}/web/matches/match-m1/live")
    visible(driver, "chat-send-btn", 5)
    small = []
    for name in ("add-to-guest-cart-btn", "chat-send-btn", "chat-input-field"):
        size = driver.find_element(*tid(name)).size
        if size["height"] < 48 or size["width"] < 48:
            small.append(f"{name} {size['width']}x{size['height']}")
    assert not small, f"targets under 48x48 CSS px: {small}"
