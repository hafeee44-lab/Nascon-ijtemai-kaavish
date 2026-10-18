import type { INestApplication } from '@nestjs/common';
import type { Express, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db } from '../db/db.service.js';
import { project } from '../scoring/projection.js';
import { EventsService } from '../scoring/events.service.js';

// Guest Web Player (FR-4.2): zero-install, zero-login pages served on :8080/web/*.
// Server-rendered so the score, player and pinned product are visible on first paint (< 3 s).

const here = dirname(fileURLToPath(import.meta.url));
const asset = (name: string) => {
  for (const p of [join(here, name), join(here, '..', '..', 'src', 'web', name)]) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  return '';
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const initials = (name: string) => (name.split(' ').filter(Boolean).slice(-1)[0] ?? '?').slice(0, 2).toUpperCase();
const CREST = ['#F97316', '#22D3EE', '#A78BFA', '#F43F5E', '#34D399', '#FACC15', '#60A5FA', '#E879F9'];
const crestColor = (id: string) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return CREST[h % CREST.length]; };
const crest = (id: string, name: string, size = 56) =>
  `<span class="crest" style="--c:${crestColor(id)};--s:${size}px" role="img" aria-label="${esc(name)} crest">${esc(initials(name))}</span>`;
const pkr = (minor: number) => `PKR ${(minor / 100).toFixed(2)}`;
const mediaHost = () => process.env.MEDIA_PUBLIC_HOST ?? 'localhost';

function shell(title: string, body: string, boot: Record<string, unknown>) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0A0F1E">
<title>${esc(title)} · NaSCon Live</title>
<link rel="stylesheet" href="/web/assets/player.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top" role="banner">
  <a class="brand" href="#main" aria-label="NaSCon Live home"><span class="logo" aria-hidden="true">N</span><span>NaSCon <b>Live</b></span></a>
  <div class="top-right">
    <span class="pill" id="who" aria-live="polite">Watching as guest</span>
    <span class="cart-pill" aria-label="Items in your cart"><span aria-hidden="true">Cart</span> <span data-testid="guest-cart-count" id="cart-count">0</span></span>
  </div>
</header>
<main id="main">${body}</main>
${authModal()}
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
<script>window.NASCON = ${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
<script src="/web/assets/player.js" defer></script>
</body>
</html>`;
}

const authModal = () => `
<div class="modal-backdrop" id="auth-backdrop" hidden>
  <div class="modal" data-testid="progressive-auth-modal" id="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" hidden>
    <h2 id="auth-title">Sign in to join in</h2>
    <p class="muted" id="auth-reason">Guests can watch for free. Sign in to chat or check out — your cart stays with you.</p>
    <form id="auth-form" novalidate>
      <label for="auth-email">Email</label>
      <input id="auth-email" name="email" type="email" autocomplete="username" placeholder="manager@nascon.test" required>
      <label for="auth-password">Password</label>
      <input id="auth-password" name="password" type="password" autocomplete="current-password" placeholder="Password" required>
      <p class="error" id="auth-error" role="alert" hidden></p>
      <div class="row">
        <button type="submit" class="btn primary" id="auth-submit">Sign in and continue</button>
        <button type="button" class="btn ghost" id="auth-close">Keep watching</button>
      </div>
      <p class="muted small">Demo accounts use password <b>Nascon@26</b> (e.g. player@nascon.test).</p>
    </form>
  </div>
</div>`;

function chatPanel(room: string) {
  return `
<section class="card chat" aria-labelledby="chat-title">
  <div class="card-head"><h2 id="chat-title">Live chat</h2><span class="muted small">${esc(room)}</span></div>
  <ul class="chat-list" data-testid="chat-message-list" id="chat-list" aria-live="polite" aria-label="Chat messages" tabindex="0"></ul>
  <form class="chat-form" id="chat-form">
    <label class="sr-only" for="chat-input">Message</label>
    <input data-testid="chat-input-field" id="chat-input" maxlength="500" placeholder="Say something nice…" autocomplete="off">
    <button data-testid="chat-send-btn" id="chat-send" type="submit" class="btn primary" aria-label="Send chat message">Send</button>
  </form>
</section>`;
}

function merchCard(product: any) {
  if (!product) return '';
  const v = product.variants.find((x: any) => x.variant_id === 'var-jersey-001-L') ?? product.variants[0];
  return `
<section class="card merch" data-testid="pinned-merch-card" id="merch" aria-labelledby="merch-title">
  <div class="jersey" aria-hidden="true"><span class="sleeve l"></span><span class="sleeve r"></span><span class="body"><span class="stripe"></span><span class="num">10</span></span></div>
  <div class="merch-info">
    <p class="eyebrow">Pinned · Official store</p>
    <h2 id="merch-title">${esc(product.name)}</h2>
    <p class="muted">Size ${esc(v.size)} · ${esc(v.variant_id)}</p>
    <p class="price">${pkr(v.price_minor)}</p>
    <div class="row">
      <button class="btn primary" data-testid="add-to-guest-cart-btn" id="add-cart" data-variant="${esc(v.variant_id)}">Add to cart</button>
      <button class="btn ghost" id="checkout">Checkout</button>
    </div>
  </div>
</section>`;
}

export function serveWeb(app: Express, nest: INestApplication) {
  const css = asset('player.css');
  const js = asset('player.js');
  app.get('/web/assets/player.css', (_req, res) => res.type('text/css').set('Cache-Control', 'no-cache').send(css));
  app.get('/web/assets/player.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-cache').send(js));

  const db = () => nest.get(Db);
  const events = () => nest.get(EventsService);
  const teamName = async (id: string) => (await db().get('club', id))?.name ?? id;

  const matchPage = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const m = await events().loadMatch(db().pool, id);
    if (!m) return res.status(404).type('html').send(shell('Not found', `<section class="card"><h1>Match not found</h1><p class="muted">This code may be out of date.</p></section>`, {}));
    const p = project(m.sport, m.match, m.events);
    const mm: any = m.match;
    const [home, away] = [await teamName(p.home.team_id), await teamName(p.away.team_id)];
    const product = mm.pinned_product_id ? await db().get('product', mm.pinned_product_id) : await db().get('product', 'prod-jersey-001');
    const keyRow = await db().query(`SELECT data FROM docs WHERE kind='stream_key' AND data->>'status'='active' ORDER BY data->>'created_at' DESC LIMIT 1`);
    const key = keyRow.rows[0]?.data?.stream_key as string | undefined;
    const hls = key ? `http://${mediaHost()}:8888/live/${key}/index.m3u8` : '';
    const label = { upcoming: 'Kick-off soon', in_progress: 'Live', completed: 'Full time', postponed: 'Postponed', cancelled: 'Cancelled', abandoned: 'Abandoned' }[p.status] ?? p.status;
    const room = `chat-${id}`;
    const notice = req.path.endsWith('/notice')
      ? `<div class="notice" role="alert">This match is <b>${esc(req.query.state ?? p.status)}</b>. We'll update this page when it's rescheduled.</div>` : '';
    const body = `
${notice}
<section class="stage" aria-label="Live match player">
  <div class="player-wrap">
    <video data-testid="guest-video-player" id="video" playsinline muted preload="none" ${hls ? `data-src="${esc(hls)}"` : ''} poster="" aria-label="Live match video"></video>
    <div class="overlay" aria-hidden="false">
      <div class="ov-score">
        ${crest(p.home.team_id, home, 34)}
        <div class="ov-mid"><span class="live-dot ${p.status === 'in_progress' ? 'on' : ''}" aria-hidden="true"></span><span id="ov-status">${esc(label)}</span></div>
        ${crest(p.away.team_id, away, 34)}
      </div>
      <div class="ov-merch" id="ov-merch">${product ? `Pinned: ${esc(product.name)}` : ''}</div>
      <p class="offline-note" id="offline-note">${hls ? 'Connecting to stream…' : 'Waiting for the broadcast to start'}</p>
    </div>
    <div class="controls" role="group" aria-label="Media controls">
      <button class="ctl" id="ctl-play" aria-label="Play">Play</button>
      <button class="ctl" id="ctl-mute" aria-label="Unmute">Unmute</button>
      <button class="ctl" id="ctl-full" aria-label="Full screen">Full screen</button>
    </div>
  </div>
  <div class="scoreboard card">
    <div class="sb-team">${crest(p.home.team_id, home)}<span>${esc(home)}</span></div>
    <div class="sb-mid">
      <div class="score" data-testid="live-score-banner" id="score" aria-live="polite" aria-label="Live score">${p.home.score} - ${p.away.score}</div>
      <div class="status" id="status-label">${esc(label)}</div>
    </div>
    <div class="sb-team">${crest(p.away.team_id, away)}<span>${esc(away)}</span></div>
  </div>
</section>
<div class="grid2">
  ${chatPanel(room)}
  ${merchCard(product)}
</div>`;
    res.type('html').send(shell(`${home} vs ${away}`, body, { kind: 'match', matchId: id, room, hls, status: p.status }));
  };

  app.get('/web/matches/:id/live', matchPage);
  app.get('/web/matches/:id/preview', matchPage);
  app.get('/web/matches/:id/vod', matchPage);
  app.get('/web/matches/:id/notice', matchPage);

  app.get('/web/costream/:id', async (req, res) => {
    const id = req.params.id;
    const s = await db().get('costream', id);
    if (!s) return res.status(404).type('html').send(shell('Not found', `<section class="card"><h1>Co-stream not found</h1></section>`, {}));
    const b = s.body;
    const product = await db().get('product', 'prod-jersey-001');
    const tiles = (b.active_participants as string[]).map((pid) =>
      `<li class="tile ${pid === b.active_host ? 'host' : ''}">${crest(pid, pid, 44)}<span>${esc(pid)}</span>${pid === b.active_host ? '<span class="badge">Host</span>' : ''}</li>`).join('');
    const body = `
<section class="stage" aria-label="Co-stream player">
  <div class="player-wrap">
    <video data-testid="guest-video-player" id="video" playsinline muted preload="none" data-src="${esc(b.composite_playback_url)}" aria-label="Co-stream video"></video>
    <div class="overlay"><p class="offline-note" id="offline-note">Co-stream · ${esc(b.layout)} · ${b.participant_count} live</p></div>
    <div class="controls" role="group" aria-label="Media controls">
      <button class="ctl" id="ctl-play" aria-label="Play">Play</button>
      <button class="ctl" id="ctl-mute" aria-label="Unmute">Unmute</button>
      <button class="ctl" id="ctl-full" aria-label="Full screen">Full screen</button>
    </div>
  </div>
  <div class="scoreboard card">
    <div class="sb-mid"><div class="score" data-testid="live-score-banner" id="score" aria-live="polite">${esc(b.status === 'active' ? 'LIVE' : 'ENDED')}</div>
    <div class="status">${b.handoff_occurred ? `Host handed over to ${esc(b.active_host)}` : `Hosted by ${esc(b.active_host ?? '—')}`}</div></div>
  </div>
  <ul class="tiles layout-${esc(b.layout)}" aria-label="Broadcasters">${tiles}</ul>
</section>
<div class="grid2">${chatPanel(b.chat_room_id)}${merchCard(product)}</div>`;
    res.type('html').send(shell(`Co-stream ${id}`, body, { kind: 'costream', sessionId: id, room: b.chat_room_id, hls: b.composite_playback_url }));
  });

  app.get('/web/players/:id', async (req, res) => {
    const id = req.params.id;
    const p = (await db().get('scenario_player', id)) ?? (await db().get('roster_player', id));
    if (!p) return res.status(404).type('html').send(shell('Not found', `<section class="card"><h1>Player not found</h1></section>`, {}));
    const club = p.club_id ? await db().get('club', p.club_id) : null;
    const follows = await db().query('SELECT count(*)::int AS n FROM follows WHERE athlete_id=$1', [id]);
    const body = `
<section class="card profile">${crest(id, p.name ?? id, 88)}
  <div><p class="eyebrow">Athlete</p><h1>${esc(p.name ?? id)}</h1><p class="muted">${esc(club?.name ?? p.club_id ?? 'Free agent')}</p>
  <p><b id="followers">${follows.rows[0].n}</b> followers</p>
  <button class="btn primary" id="follow" data-athlete="${esc(id)}">Follow</button></div>
</section>`;
    res.type('html').send(shell(p.name ?? id, body, { kind: 'player', playerId: id }));
  });

  app.get('/web/clubs/:id', async (req, res) => {
    const c = await db().get('club', req.params.id);
    if (!c) return res.status(404).type('html').send(shell('Not found', `<section class="card"><h1>Club not found</h1></section>`, {}));
    const body = `
<section class="card profile">${crest(c.club_id, c.name ?? c.club_id, 88)}
  <div><p class="eyebrow">Club</p><h1>${esc(c.name ?? c.club_id)}</h1><p class="muted">${esc(c.venue?.name ?? '')}</p>
  <p class="muted">${esc(c.social?.x ?? '')} ${esc(c.social?.instagram ?? '')}</p></div>
</section>`;
    res.type('html').send(shell(c.name ?? c.club_id, body, { kind: 'club', clubId: c.club_id }));
  });
}
