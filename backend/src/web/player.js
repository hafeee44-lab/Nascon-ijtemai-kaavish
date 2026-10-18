// NaSCon Live guest web player — no build step, no framework. Guests are read-only by design:
// every write goes to the server, which answers 403 GUEST_WRITE_FORBIDDEN, and we then offer sign-in.
(function () {
  'use strict';
  var B = window.NASCON || {};
  var $ = function (id) { return document.getElementById(id); };
  var store = window.sessionStorage;
  var pendingAction = null;

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function api(method, path, body, token) {
    var headers = { 'Content-Type': 'application/json' };
    var tok = token || store.getItem('member_token') || store.getItem('guest_token');
    if (tok) headers.Authorization = 'Bearer ' + tok;
    return fetch(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.text().then(function (t) {
        var data = t ? JSON.parse(t) : null;
        return { status: r.status, ok: r.ok, data: data };
      });
    });
  }

  // ---- zero-friction guest token (no login wall) ----
  function ensureGuest() {
    if (store.getItem('guest_token')) return Promise.resolve(store.getItem('guest_token'));
    return api('POST', '/api/v1/guest/token', {}, 'none').then(function (r) {
      if (r.ok) store.setItem('guest_token', r.data.guest_token);
      return store.getItem('guest_token');
    });
  }

  function setWho() {
    var who = $('who');
    var email = store.getItem('member_email');
    if (who) who.textContent = email ? 'Signed in · ' + email : 'Watching as guest';
  }

  // ---- guest cart ----
  function setCount(n) { var c = $('cart-count'); if (c) c.textContent = String(n); }
  function refreshCart() {
    var g = store.getItem('guest_token');
    if (!g || store.getItem('member_token')) return;
    api('GET', '/api/v1/guest/cart', null, g).then(function (r) { if (r.ok) setCount(r.data.count); });
  }
  function addToCart(variant) {
    var current = Number(($('cart-count') || {}).textContent || 0);
    setCount(current + 1); // optimistic, reconciled with the server below
    ensureGuest().then(function (g) {
      return api('POST', '/api/v1/guest/cart', { variant_id: variant, quantity: 1 }, g);
    }).then(function (r) {
      if (r.ok) { setCount(r.data.count); toast('Added to your cart.'); }
      else { setCount(current); toast((r.data && r.data.error && r.data.error.message) || 'Could not add to cart.'); }
    });
  }

  // ---- progressive auth modal ----
  var lastFocus = null;
  function openAuth(reason) {
    lastFocus = document.activeElement;
    $('auth-reason').textContent = reason || 'Guests can watch for free. Sign in to chat or check out — your cart stays with you.';
    $('auth-backdrop').hidden = false;
    $('auth-modal').hidden = false;
    setTimeout(function () { $('auth-email').focus(); }, 30);
  }
  function closeAuth() {
    $('auth-backdrop').hidden = true;
    $('auth-modal').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function signIn(e) {
    e.preventDefault();
    var err = $('auth-error');
    err.hidden = true;
    var video = $('video');
    var resumeAt = video ? video.currentTime : 0; // return to the exact playback position
    $('auth-submit').disabled = true;
    api('POST', '/api/v1/guest/upgrade', { email: $('auth-email').value.trim(), password: $('auth-password').value, guest_token: store.getItem('guest_token') }, 'none')
      .then(function (r) {
        $('auth-submit').disabled = false;
        if (!r.ok) {
          err.textContent = 'That email or password is incorrect.';
          err.hidden = false;
          return;
        }
        store.setItem('member_token', r.data.token);
        store.setItem('member_email', r.data.user.email);
        setWho();
        if (r.data.merge) setCount(r.data.merge.active_cart.total_items);
        closeAuth();
        if (video && resumeAt) video.currentTime = resumeAt;
        toast(r.data.merge ? 'Signed in. Your cart has ' + r.data.merge.active_cart.total_items + ' item(s).' : 'Signed in.');
        var next = pendingAction;
        pendingAction = null;
        if (next) next();
      });
  }

  // ---- chat ----
  function renderMsg(m) {
    var list = $('chat-list');
    if (!list) return;
    var empty = list.querySelector('.empty');
    if (empty) empty.remove();
    var li = document.createElement('li');
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = m.sender;
    li.appendChild(who);
    li.appendChild(document.createTextNode(m.text));
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }
  function loadChat() {
    if (!B.room) return;
    api('GET', '/api/v1/chat/' + encodeURIComponent(B.room), null, 'none').then(function (r) {
      var list = $('chat-list');
      if (!list) return;
      list.innerHTML = '';
      if (r.ok && r.data.messages.length) r.data.messages.forEach(renderMsg);
      else list.innerHTML = '<li class="empty">No messages yet — be the first to cheer.</li>';
    });
  }
  function sendChat(e) {
    e.preventDefault();
    var input = $('chat-input');
    var text = input.value.trim();
    if (!text) return;
    var send = function () {
      return api('POST', '/api/v1/chat', { chat_room_id: B.room, text: text, match_id: B.matchId || null }).then(function (r) {
        if (r.status === 403) { pendingAction = send; openAuth('Sign in to send messages in the live chat.'); return; }
        if (r.status === 401) { store.removeItem('member_token'); pendingAction = send; openAuth('Your session expired. Please sign in again.'); return; }
        if (r.ok && r.data.accepted === false) { toast(r.data.reason === 'rate_limit_exceeded' ? 'Slow down — max 3 messages every 2 seconds.' : 'That message was blocked by the chat filter.'); return; }
        if (r.ok) input.value = '';
      });
    };
    ensureGuest().then(send);
  }

  // ---- live score + chat over SSE (NFR-1), with polling fallback ----
  function setScore(s) {
    var el = $('score');
    if (!el || !s || s.score === undefined) return;
    if (el.textContent !== s.score) {
      el.textContent = s.score;
      el.classList.add('flash');
      setTimeout(function () { el.classList.remove('flash'); }, 600);
    }
    var label = { upcoming: 'Kick-off soon', in_progress: 'Live', completed: 'Full time', postponed: 'Postponed', cancelled: 'Cancelled', abandoned: 'Abandoned' }[s.status] || s.status;
    var st = $('status-label');
    if (st) st.textContent = label;
    var ov = $('ov-status');
    if (ov) ov.textContent = label;
  }
  function connect() {
    var url = B.kind === 'match' ? '/api/v1/matches/' + encodeURIComponent(B.matchId) + '/stream' : B.room ? '/api/v1/chat/' + encodeURIComponent(B.room) + '/stream' : null;
    if (!url || !window.EventSource) return;
    var es = new EventSource(url);
    es.addEventListener('score', function (e) { setScore(JSON.parse(e.data)); });
    es.addEventListener('chat.message', function (e) { renderMsg(JSON.parse(e.data)); });
    es.addEventListener('match.product_pinned', function () { toast('A new product was pinned to this match.'); });
    es.onerror = function () { /* EventSource reconnects automatically */ };
  }

  // ---- media ----
  function setupVideo() {
    var v = $('video');
    if (!v) return;
    var src = v.getAttribute('data-src');
    var note = $('offline-note');
    if (src && v.canPlayType('application/vnd.apple.mpegurl')) v.src = src;
    else if (src) v.src = src; // HLS-capable browsers play it; others keep the overlay message
    // A playlist requested while the media server is still warming up fails once and the element never
    // retries on its own, so reload the source with backoff (2 s, 4 s … capped at 10 s) until it plays.
    var retries = 0, wanted = false;
    v.addEventListener('playing', function () { retries = 0; if (note) note.hidden = true; });
    v.addEventListener('error', function () {
      if (!src) return;
      if (note) { note.hidden = false; note.textContent = 'Connecting to stream…'; }
      setTimeout(function () {
        v.src = src; v.load();
        if (wanted) v.play().catch(function () {});
      }, Math.min(10000, 2000 * Math.pow(2, retries++)));
    });
    var play = $('ctl-play'), mute = $('ctl-mute'), full = $('ctl-full');
    if (play) play.addEventListener('click', function () {
      if (v.paused) { wanted = true; v.play().catch(function () { if (!src) toast('The broadcast has not started yet.'); }); play.textContent = 'Pause'; play.setAttribute('aria-label', 'Pause'); }
      else { wanted = false; v.pause(); play.textContent = 'Play'; play.setAttribute('aria-label', 'Play'); }
    });
    if (mute) mute.addEventListener('click', function () {
      v.muted = !v.muted;
      mute.textContent = v.muted ? 'Unmute' : 'Mute';
      mute.setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute');
    });
    if (full) full.addEventListener('click', function () { (v.requestFullscreen || v.webkitRequestFullscreen || function () {}).call(v); });
  }

  // ---- follow (player page) ----
  function setupFollow() {
    var btn = $('follow');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var go = function () {
        return api('POST', '/api/v1/athletes/' + encodeURIComponent(btn.getAttribute('data-athlete')) + '/follow', {}).then(function (r) {
          if (r.status === 403 || r.status === 401) { pendingAction = go; openAuth('Sign in to follow athletes.'); return; }
          if (r.ok) { $('followers').textContent = r.data.follower_count; btn.textContent = 'Following'; }
        });
      };
      ensureGuest().then(go);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('auth-modal').hidden) closeAuth();
  });

  document.addEventListener('DOMContentLoaded', function () {
    setWho();
    ensureGuest().then(refreshCart);
    setupVideo();
    loadChat();
    connect();
    setupFollow();
    var add = $('add-cart');
    if (add) add.addEventListener('click', function () { addToCart(add.getAttribute('data-variant')); });
    var co = $('checkout');
    if (co) co.addEventListener('click', function () {
      if (!store.getItem('member_token')) { openAuth('Sign in to check out. Your cart will come with you.'); return; }
      toast('Your cart is saved to your account — finish checkout in the NaSCon app.');
    });
    var form = $('chat-form');
    if (form) form.addEventListener('submit', sendChat);
    $('auth-form').addEventListener('submit', signIn);
    $('auth-close').addEventListener('click', closeAuth);
    $('auth-backdrop').addEventListener('click', closeAuth);
  });
})();
