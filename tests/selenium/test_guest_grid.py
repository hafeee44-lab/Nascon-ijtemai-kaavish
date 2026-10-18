"""Guest Web Player — Selenium Grid 4 suite (spec §6.2.3), parallel across Chrome and Firefox nodes."""
import time
import uuid

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from conftest import APP_URL, api


def tid(name):
    return (By.CSS_SELECTOR, f'[data-testid="{name}"]')


def test_qr_resolution_zero_friction_load(driver):
    """Test 1: /q/m1-live redirects to the live page; player + score render < 3 s; no login modal."""
    start = time.monotonic()
    driver.get(f"{APP_URL}/q/m1-live")
    wait = WebDriverWait(driver, 3, poll_frequency=0.05)
    wait.until(EC.url_contains("/web/matches/match-m1/live"))
    assert wait.until(EC.visibility_of_element_located(tid("guest-video-player")))
    assert wait.until(EC.visibility_of_element_located(tid("live-score-banner")))
    assert time.monotonic() - start < 3.0
    assert not driver.find_element(*tid("progressive-auth-modal")).is_displayed()
    for name in ["pinned-merch-card", "add-to-guest-cart-btn", "guest-cart-count", "chat-message-list", "chat-input-field", "chat-send-btn"]:
        assert driver.find_elements(*tid(name)), f"missing data-testid={name}"


def test_guest_write_block_progressive_modal(driver):
    """Test 2: a guest chat send is refused server-side (403) and opens the registration modal."""
    driver.get(f"{APP_URL}/web/matches/match-m1/live")
    wait = WebDriverWait(driver, 5, poll_frequency=0.05)
    box = wait.until(EC.element_to_be_clickable(tid("chat-input-field")))
    text = f"guest says hi {uuid.uuid4().hex[:6]}"
    box.send_keys(text)
    driver.find_element(*tid("chat-send-btn")).click()
    modal = wait.until(EC.visibility_of_element_located(tid("progressive-auth-modal")))
    assert modal.is_displayed()
    assert text not in driver.find_element(*tid("chat-message-list")).text


def test_guest_cart_and_realtime_score(driver):
    """Test 3: staging a guest cart item updates the count; a posted score reaches the banner < 500 ms."""
    driver.get(f"{APP_URL}/web/matches/match-m1/live")
    wait = WebDriverWait(driver, 5, poll_frequency=0.05)
    count = wait.until(EC.visibility_of_element_located(tid("guest-cart-count")))
    wait.until(lambda d: d.execute_script("return !!sessionStorage.getItem('guest_token')"))
    assert count.text == "0"
    driver.find_element(*tid("add-to-guest-cart-btn")).click()
    wait.until(EC.text_to_be_present_in_element(tid("guest-cart-count"), "1"))

    banner = driver.find_element(*tid("live-score-banner"))
    before = banner.text
    time.sleep(0.5)  # let the SSE subscription settle
    t0 = time.monotonic()
    api("POST", "/audit/v1/events", {"event_id": f"sel-{uuid.uuid4().hex[:10]}", "match_id": "match-m1", "type": "score",
                                     "payload": {"team_id": "club-alpha-1", "event_type": "goal"}})
    WebDriverWait(driver, 2, poll_frequency=0.02).until(lambda d: d.find_element(*tid("live-score-banner")).text != before)
    elapsed = time.monotonic() - t0
    assert elapsed < 0.5, f"score banner took {elapsed * 1000:.0f} ms"
