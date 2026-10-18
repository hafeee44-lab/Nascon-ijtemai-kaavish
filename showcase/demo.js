// CLUB|HOUSE Live — static demo layer (only included in the showcase build deployed to Vercel).
// The real app is a NestJS + PostgreSQL + Redis + MediaMTX stack; a static host can't run it, so this
// script stands in for the API in the browser: it answers the page's fetch() calls, replaces the
// Server-Sent Events stream with a simulator (goals, fan chat, QR scans), and loops a recorded clip
// instead of the live HLS feed. State lives in sessionStorage so it survives page navigation.
(function () {
  'use strict';
  var KEY = 'clubhouse_demo_v1';
  var S;
  try { S = JSON.parse(sessionStorage.getItem(KEY) || '') || null; } catch (e) { S = null; }
  S = S || { cart: 0, scores: {}, rooms: {}, scans: {}, seq: 100 };
  var save = function () { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode */ } };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (a) { return a[(Math.random() * a.length) | 0]; };

  // ---------- moderation (same rules as the server: leetspeak-normalised word list, floods) ----------
  var BAD = ['badword', 'scam', 'idiot', 'shit', 'fuck', 'bitch', 'porn', 'asshole'];
  var norm = function (w) { return w.toLowerCase().replace(/@/g, 'a').replace(/0/g, 'o').replace(/[1!]/g, 'i').replace(/\$/g, 's').replace(/3/g, 'e').replace(/[^a-z]/g, ''); };
  function moderate(text) {
    if (/(\S)\1{3,}/i.test(text) || /!{3,}|\?{3,}/.test(text)) return { ok: false, reason: 'flood_character_repeat' };
    return { ok: true, text: text.replace(/\S+/g, function (w) { var n = norm(w); return BAD.some(function (b) { return n.indexOf(b) >= 0; }) ? '***' : w; }) };
  }

  // ---------- chat rooms ----------
  var FANS = ['lions_ultra', 'falcon_fan', 'aisha_k', 'hamza.10', 'saad_fc', 'zara.watches', 'coach_ali', 'mehak_r'];
  var CHEERS = ['What a save!', 'Come on Lions!', 'That pass though 🔥', 'Ref, really?', 'Best atmosphere tonight', 'Scanned the QR at the gate, works great', 'Who else is watching from the stands?', 'Falcons pressing high now', 'Get the jersey, it looks clean', 'Unreal finish!', 'Defence is solid today', 'One more goal please'];
  function room(id) {
    if (!S.rooms[id]) {
      S.rooms[id] = [
        { seq: 1, sender: 'lions_ultra', text: 'Kick-off! Let’s go 🦁' },
        { seq: 2, sender: 'aisha_k', text: 'Scanned the QR at the gate and I’m in, no sign-up' },
        { seq: 3, sender: 'falcon_fan', text: 'Falcons will turn this around' },
      ];
      save();
    }
    return S.rooms[id];
  }
  function post(roomId, sender, text) {
    var m = { seq: ++S.seq, sender: sender, text: text, chat_room_id: roomId };
    room(roomId).push(m);
    if (S.rooms[roomId].length > 40) S.rooms[roomId].shift();
    save();
    streams.forEach(function (es) { if (es.room === roomId) es.emit('chat.message', m); });
    return m;
  }

  // ---------- fetch() stand-in for the API ----------
  var realFetch = window.fetch.bind(window);
  var reply = function (status, body) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }));
  };
  window.fetch = function (input, init) {
    init = init || {};
    var url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin) return realFetch(input, init);
    var p = url.pathname, method = (init.method || 'GET').toUpperCase(), body = {}, m;
    try { body = init.body ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
    if (p === '/api/v1/guest/token') return reply(201, { guest_token: 'guest_demo_' + Math.random().toString(36).slice(2, 10) });
    if (p === '/api/v1/guest/cart') { if (method === 'POST') { S.cart += 1; save(); } return reply(method === 'POST' ? 201 : 200, { count: S.cart }); }
    if (p === '/api/v1/guest/upgrade') {
      if (body.password !== 'Nascon@26') return reply(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' } });
      return reply(200, { token: 'demo_member_token', user: { email: body.email }, merge: { active_cart: { total_items: S.cart } } });
    }
    if ((m = p.match(/^\/api\/v1\/chat\/([^/]+)$/))) return reply(200, { chat_room_id: m[1], messages: room(decodeURIComponent(m[1])) });
    if (p === '/api/v1/chat' && method === 'POST') {
      if (!sessionStorage.getItem('member_token')) return reply(403, { error: { code: 'GUEST_WRITE_FORBIDDEN', message: 'Guests are read-only.' } });
      var r = moderate(String(body.text || ''));
      if (!r.ok) return reply(200, { accepted: false, reason: r.reason });
      var who = (sessionStorage.getItem('member_email') || 'you').split('@')[0];
      return reply(201, { accepted: true, message: post(body.chat_room_id, who, r.text) });
    }
    if ((m = p.match(/^\/audit\/v1\/qr\/([^/]+)$/))) {
      var id = decodeURIComponent(m[1]), info = (window.DEMO_QR || {})[id] || {};
      return reply(200, { entity_id: id, entity_status: info.status || 'in_progress', target_route: info.target || '/web', scan_count: S.scans[id] || 0 });
    }
    if (p.indexOf('/api/') === 0 || p.indexOf('/audit/') === 0) return reply(503, { error: { code: 'DEMO_STATIC', message: 'This is the static demo build.' } });
    return realFetch(input, init);
  };

  // ---------- EventSource stand-in: the live score + chat stream ----------
  var streams = [];
  function DemoStream(url) {
    var u = new URL(url, location.href), m;
    this.listeners = {};
    if ((m = u.pathname.match(/^\/api\/v1\/matches\/([^/]+)\/stream$/))) { this.match = decodeURIComponent(m[1]); this.room = 'chat-' + this.match; }
    else if ((m = u.pathname.match(/^\/api\/v1\/chat\/([^/]+)\/stream$/))) this.room = decodeURIComponent(m[1]);
    streams.push(this);
    var self = this;
    setTimeout(function () { if (self.match && S.scores[self.match]) self.emit('score', { score: S.scores[self.match], status: 'in_progress' }); }, 60);
  }
  DemoStream.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
  DemoStream.prototype.emit = function (t, d) { (this.listeners[t] || []).forEach(function (f) { f({ data: JSON.stringify(d) }); }); };
  DemoStream.prototype.close = function () { streams = streams.filter(function (s) { return s !== this; }, this); };
  window.EventSource = DemoStream;

  function goal(matchId) {
    var parts = (S.scores[matchId] || '0 - 0').split('-').map(function (x) { return parseInt(x, 10) || 0; });
    parts[Math.random() < 0.55 ? 0 : 1] += 1;
    S.scores[matchId] = parts[0] + ' - ' + parts[1];
    save();
    streams.forEach(function (es) { if (es.match === matchId) es.emit('score', { score: S.scores[matchId], status: 'in_progress' }); });
    if (window.NASCON && window.NASCON.room === 'chat-' + matchId) setTimeout(function () { post('chat-' + matchId, pick(FANS), pick(['GOOOAL! What a strike!', 'Did you see that?! ⚽', 'Unreal finish!'])); }, 900);
  }

  // ---------- page wiring once the DOM is ready ----------
  document.addEventListener('DOMContentLoaded', function () {
    var B = window.NASCON || {};
    // seed scores from the server-rendered snapshot the first time we see a match
    var seed = function (id, text) { if (id && text && !S.scores[id]) S.scores[id] = text.trim(); };
    if (B.kind === 'match') seed(B.matchId, (document.getElementById('score') || {}).textContent);
    var hero = document.getElementById('hero-card');
    if (hero) seed(hero.dataset.match, (document.getElementById('hero-score') || {}).textContent);
    document.querySelectorAll('.mcard').forEach(function (c) {
      var id = (c.getAttribute('href') || '').split('/')[3], sc = c.querySelector('.mc-score');
      if (sc) { seed(id, sc.textContent); sc.textContent = S.scores[id] || sc.textContent; }
    });
    if (hero && S.scores[hero.dataset.match]) document.getElementById('hero-score').textContent = S.scores[hero.dataset.match];
    if (B.kind === 'match' && S.scores[B.matchId]) document.getElementById('score').textContent = S.scores[B.matchId];
    save();

    // Live pages play the recorded broadcast clip (runs before player.js reads data-src).
    var v = document.getElementById('video');
    if (v) {
      v.loop = true;
      var live = B.kind === 'costream' || (B.kind === 'match' && B.status === 'in_progress');
      if (live && !v.getAttribute('data-src')) {
        v.setAttribute('data-src', '/web/assets/media/broadcast.mp4');
        var note = document.getElementById('offline-note');
        if (note) note.textContent = 'Press play to watch';
      }
    }

    // simulated live activity
    var liveMatch = B.kind === 'match' && B.status === 'in_progress' ? B.matchId : hero ? hero.dataset.match : null;
    if (liveMatch) (function loop() { setTimeout(function () { goal(liveMatch); loop(); }, rnd(B.kind === 'home' ? 9000 : 22000, B.kind === 'home' ? 15000 : 34000)); })();
    if (B.room) (function chat() { setTimeout(function () { post(B.room, pick(FANS), pick(CHEERS)); chat(); }, rnd(5000, 9000)); })();
    if (B.kind === 'qr') (function scan() { setTimeout(function () { S.scans[B.entityId] = (S.scans[B.entityId] || 0) + 1; save(); scan(); }, rnd(5000, 10000)); })();

    // honest label
    var tag = document.createElement('a');
    tag.href = 'https://github.com/hafeee44-lab/Nascon-ijtemai-kaavish/tree/portfolio-ui';
    tag.target = '_blank';
    tag.rel = 'noopener';
    tag.className = 'demo-tag';
    tag.innerHTML = '<b>Demo build</b><span>Live data simulated in your browser · full stack (NestJS · Postgres · Redis · MediaMTX) on GitHub ↗</span>';
    document.body.appendChild(tag);
  });
})();
