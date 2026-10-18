import type { INestApplication } from '@nestjs/common';
import type { Express, NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { Db } from '../db/db.service.js';
import { project } from '../scoring/projection.js';
import { EventsService } from '../scoring/events.service.js';
import { QrService } from '../qr_guest/qr.js';

// CLUB|HOUSE Live web (FR-4.2): zero-install, zero-login pages served on :8080/web/*.
// Server-rendered so the score, player and pinned product are visible on first paint (< 3 s);
// the home and QR pages layer a Three.js stadium on top (progressive enhancement, CSS fallback).

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
const assetsDir = [join(here, 'assets'), join(here, '..', '..', 'src', 'web', 'assets')].find((p) => existsSync(p)) ?? join(here, 'assets');
const TYPES: Record<string, string> = {
  '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const initials = (name: string) => (name.split(' ').filter(Boolean).slice(-1)[0] ?? '?').slice(0, 2).toUpperCase();
const CREST = ['#F97316', '#22D3EE', '#A78BFA', '#F43F5E', '#34D399', '#FACC15', '#60A5FA', '#E879F9'];
const crestColor = (id: string) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return CREST[h % CREST.length]; };
const crest = (id: string, name: string, size = 56) =>
  `<span class="crest" style="--c:${crestColor(id)};--s:${size}px" role="img" aria-label="${esc(name)} crest">${esc(initials(name))}</span>`;
const pkr = (minor: number) => `PKR ${(minor / 100).toFixed(2)}`;
const STATUS_LABEL: Record<string, string> = { upcoming: 'Kick-off soon', in_progress: 'Live', completed: 'Full time', postponed: 'Postponed', cancelled: 'Cancelled', abandoned: 'Abandoned' };
const ROUTE_FOR: Record<string, string> = { upcoming: 'preview', in_progress: 'live', completed: 'vod' };
const when = (iso?: string) => {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
};
// "Open in the app" for phones: Chrome on Android only launches a custom scheme from a tapped link, and the
// intent:// form names our package so it opens the app directly (or stays on this page if it isn't installed).
const appLink = (path: string, back: string) =>
  `<a class="btn ghost app-link" id="open-in-app" href="intent://${esc(path)}#Intent;scheme=nascon;package=com.nasconapp;S.browser_fallback_url=${encodeURIComponent(back)};end" data-deeplink="nascon://${esc(path)}">Open in the app</a>`;

// HLS is served by MediaMTX on the same machine as the API, so a phone that reached this page over the
// hotspot (http://<laptop-ip>:8080) must fetch video from that same host, not from its own localhost.
const mediaHost = (req: Request) => process.env.MEDIA_PUBLIC_HOST ?? (req.hostname || 'localhost');

const LOGO = `<svg width="20" height="20" viewBox="0 0 28 28" aria-hidden="true"><path d="M6 7h16v5H11v10H6z M15 15h5v7h-5z" fill="#fff"/></svg>`;

type ShellOpts = { bodyClass?: string; module?: string; desc?: string };
function shell(title: string, body: string, boot: Record<string, unknown>, opts: ShellOpts = {}) {
  const desc = opts.desc ?? 'Live video, live scores, chat and the club store for every match. Scan, watch, no sign-up.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0b0d">
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)} · CLUB|HOUSE Live">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="/web/assets/img/stadium.jpg">
<title>${esc(title)} · CLUB|HOUSE Live</title>
<link rel="preload" href="/web/assets/fonts/BarlowCondensed-Bold.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preload" href="/web/assets/fonts/Poppins-Regular.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/web/assets/player.css">
<link rel="stylesheet" href="/web/assets/site.css">
</head>
<body class="${esc(opts.bodyClass ?? '')}">
<a class="skip" href="#main">Skip to content</a>
<header class="top" role="banner">
  <a class="brand" href="/web" aria-label="CLUB|HOUSE Live home"><span class="logo">${LOGO}</span><span>CLUB<b>|</b>HOUSE</span></a>
  <nav class="nav" aria-label="Primary">
    <a href="/web#matches">Matches</a>
    <a href="/web#costreams">Co-streams</a>
    <a href="/web/qr/match-m1">Scan QR</a>
  </nav>
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
${opts.module ? `<script type="module" src="/web/assets/${esc(opts.module)}"></script>` : ''}
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

const icon = (name: 'scan' | 'play' | 'chat' | 'shield' | 'bolt' | 'users') => {
  const paths: Record<string, string> = {
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h3v3H8zM13 13h3v3h-3zM13 9h3M9 15h2',
    play: 'M8 5.5v13l11-6.5z',
    chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4',
    bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
    users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .8 3 2.8 3 6',
  };
  return `<svg class="ico" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
};

export function serveWeb(app: Express, nest: INestApplication) {
  const css = asset('player.css');
  const js = asset('player.js');
  app.get('/web/assets/player.css', (_req, res) => res.type('text/css').set('Cache-Control', 'no-cache').send(css));
  app.get('/web/assets/player.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-cache').send(js));
  // Static design assets (site.css, Three.js modules, self-hosted fonts, images). Path-traversal safe.
  app.use('/web/assets', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rel = normalize(decodeURIComponent(req.path)).replace(/^[/\\]+/, '');
    if (!rel || rel.startsWith('..')) return next();
    const file = join(assetsDir, rel);
    if (!file.startsWith(assetsDir) || !existsSync(file)) return next();
    const longLived = rel.startsWith('vendor/') || rel.startsWith('fonts/') || rel.startsWith('img/');
    res.type(TYPES[extname(file)] ?? 'application/octet-stream').set('Cache-Control', longLived ? 'public, max-age=86400' : 'no-cache').sendFile(file);
  });

  const db = () => nest.get(Db);
  const events = () => nest.get(EventsService);
  const qr = () => nest.get(QrService);
  const teamName = async (id: string) => (await db().get('club', id))?.name ?? id;

  type Card = { id: string; status: string; home: string; away: string; homeId: string; awayId: string; score: string; venue: string; kickoff: string; league: string; sport: string };
  async function matchCards(): Promise<Card[]> {
    const rows = await db().query(`SELECT id, data FROM docs WHERE kind='match' ORDER BY data->>'kickoff', id`);
    const leagues = new Map<string, string>();
    const out: Card[] = [];
    for (const r of rows.rows) {
      const m = await events().loadMatch(db().pool, r.id);
      if (!m) continue;
      const p = project(m.sport, m.match, m.events);
      const d: any = r.data;
      // Only real fixtures: contract probes create throwaway matches without a league or named clubs.
      if (!d.league_id || !(await db().get('club', p.home.team_id)) || !(await db().get('club', p.away.team_id))) continue;
      if (!leagues.has(d.league_id)) leagues.set(d.league_id, (await db().get('league', d.league_id))?.name ?? d.league_id);
      out.push({
        id: r.id, status: p.status, home: await teamName(p.home.team_id), away: await teamName(p.away.team_id),
        homeId: p.home.team_id, awayId: p.away.team_id, score: `${p.home.score} - ${p.away.score}`,
        venue: d.venue ?? '', kickoff: d.kickoff ?? '', league: leagues.get(d.league_id) ?? '', sport: d.sport_id ?? '',
      });
    }
    const rank: Record<string, number> = { in_progress: 0, upcoming: 1, completed: 2 };
    return out.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.kickoff.localeCompare(b.kickoff));
  }
  const matchCard = (c: Card) => {
    const live = c.status === 'in_progress';
    const route = ROUTE_FOR[c.status] ?? 'notice';
    const cta = { live: 'Watch live', preview: 'Preview', vod: 'Replay', notice: 'Details' }[route];
    const centre = c.status === 'upcoming' ? `<span class="mc-time">${esc(when(c.kickoff).split(', ').pop() ?? '')}</span>` : `<span class="mc-score">${esc(c.score)}</span>`;
    return `
<a class="mcard ${live ? 'is-live' : ''}" href="/web/matches/${esc(c.id)}/${route}" data-status="${esc(c.status)}">
  <div class="mc-top"><span class="chip ${live ? 'live' : ''}">${live ? '<i class="dot"></i>' : ''}${esc(STATUS_LABEL[c.status] ?? c.status)}</span><span class="mc-league">${esc(c.league)}</span></div>
  <div class="mc-body">
    <div class="mc-team">${crest(c.homeId, c.home, 46)}<b>${esc(c.home)}</b></div>
    ${centre}
    <div class="mc-team">${crest(c.awayId, c.away, 46)}<b>${esc(c.away)}</b></div>
  </div>
  <div class="mc-foot"><span>${esc(when(c.kickoff))}${c.venue ? ` · ${esc(c.venue)}` : ''}</span><span class="go">${cta} <span aria-hidden="true">→</span></span></div>
</a>`;
  };

  const homePage = async (req: Request, res: Response) => {
    const cards = await matchCards();
    const live = cards.filter((c) => c.status === 'in_progress');
    const feat = live.find((c) => c.id === 'match-m1') ?? live[0] ?? cards[0];
    const cs = await db().query(`SELECT data FROM docs WHERE kind='costream' AND data->'body'->>'status'='active' ORDER BY data->>'updated_at' DESC LIMIT 6`);
    const costreams = cs.rows.map((r: any) => r.data.body);
    const featCard = feat ? `
  <aside class="hero-card glass" id="hero-card" aria-label="Featured match" data-match="${esc(feat.id)}" data-home-color="${crestColor(feat.homeId)}" data-away-color="${crestColor(feat.awayId)}">
    <div class="hc-top"><span class="chip ${feat.status === 'in_progress' ? 'live' : ''}">${feat.status === 'in_progress' ? '<i class="dot"></i>' : ''}${esc(STATUS_LABEL[feat.status] ?? feat.status)}</span><span class="mc-league">${esc(feat.league)}</span></div>
    <div class="hc-body">
      <div class="hc-team">${crest(feat.homeId, feat.home, 58)}<b>${esc(feat.home)}</b></div>
      <div class="hc-score" id="hero-score" aria-live="polite">${esc(feat.score)}</div>
      <div class="hc-team">${crest(feat.awayId, feat.away, 58)}<b>${esc(feat.away)}</b></div>
    </div>
    <div class="hc-foot"><span id="hero-status">${esc(feat.venue)}</span><a href="/web/matches/${esc(feat.id)}/${ROUTE_FOR[feat.status] ?? 'notice'}">Watch <span aria-hidden="true">→</span></a></div>
  </aside>` : '';
    const groups = [
      { title: 'Live now', items: cards.filter((c) => c.status === 'in_progress') },
      { title: 'Coming up', items: cards.filter((c) => c.status === 'upcoming') },
      { title: 'Results', items: cards.filter((c) => c.status !== 'in_progress' && c.status !== 'upcoming') },
    ].filter((g) => g.items.length);
    const body = `
<section class="hero" aria-label="CLUB|HOUSE Live">
  <canvas id="stadium" class="hero-canvas" aria-hidden="true"></canvas>
  <div class="hero-shade" aria-hidden="true"></div>
  <div class="hero-grid">
    <div class="hero-copy">
      <p class="kicker"><span class="dot" aria-hidden="true"></span>${live.length} ${live.length === 1 ? 'match' : 'matches'} live right now</p>
      <h1 class="display">Every match.<br>Every seat.<br><em>Live.</em></h1>
      <p class="lead">Scan the code at the stadium and you're watching in seconds: live video, the score as it happens, chat and the club store. No app, no sign-up.</p>
      <div class="cta-row">
        ${feat ? `<a class="btn primary lg" href="/web/matches/${esc(feat.id)}/${ROUTE_FOR[feat.status] ?? 'notice'}">${icon('play')} Watch live</a>` : ''}
        ${feat ? `<a class="btn ghost lg" href="/web/qr/${esc(feat.id)}">${icon('scan')} Scan to watch</a>` : ''}
      </div>
    </div>
    ${featCard}
  </div>
  <a class="scroll-cue" href="#matches" aria-label="Scroll to matches"><span></span></a>
</section>

<section class="section stats reveal" aria-label="Measured performance">
  <div class="stat"><b>0.25<small>s</small></b><span>Stream key revoked → broadcast off air</span></div>
  <div class="stat"><b>2.5<small>s</small></b><span>Goal scored on one phone → every viewer</span></div>
  <div class="stat"><b>500</b><span>Viewers + 50 chatters under load, 0% errors</span></div>
  <div class="stat"><b>12<small>/12</small></b><span>Selenium Grid tests on Chrome &amp; Firefox</span></div>
</section>

<section class="section" id="matches" aria-labelledby="matches-title">
  <div class="section-head reveal"><p class="eyebrow">Match centre</p><h2 class="h-display" id="matches-title">Live, next up &amp; results</h2></div>
  ${groups.map((g) => `<h3 class="group-title reveal">${esc(g.title)}</h3><div class="mgrid">${g.items.map(matchCard).join('')}</div>`).join('')}
</section>

<section class="section how" aria-labelledby="how-title">
  <div class="section-head reveal"><p class="eyebrow">How it works</p><h2 class="h-display" id="how-title">From the stands to the stream in seconds</h2></div>
  <ol class="steps">
    <li class="step reveal"><span class="step-ico">${icon('scan')}</span><h3>Scan one code</h3><p>Every match has one QR for the whole season. Our server checks the match state on each scan and routes you to live, preview, replay or a notice.</p></li>
    <li class="step reveal"><span class="step-ico">${icon('play')}</span><h3>Watch instantly</h3><p>HLS video from our media server, the score pushed over Server-Sent Events, no login. Revoked streams are cut in a quarter of a second.</p></li>
    <li class="step reveal"><span class="step-ico">${icon('chat')}</span><h3>Join in when you want</h3><p>Chat and the club store ask you to sign in only when you write. Your guest cart moves into your account in one transaction.</p></li>
  </ol>
</section>

<section class="section" id="costreams" aria-labelledby="cs-title">
  <div class="section-head reveal"><p class="eyebrow">Co-streams</p><h2 class="h-display" id="cs-title">Watch with the players</h2>
    <p class="muted">Up to four creators broadcast together. If the host drops, the next player takes over in under 1.5 s.</p></div>
  ${costreams.length ? `<div class="csgrid">${costreams.map((b: any) => `
    <a class="cscard reveal" href="/web/costream/${esc(b.session_id)}">
      <div class="cs-wall">${(b.active_participants as string[]).slice(0, 4).map((p: string) => `<span class="cs-cell ${p === b.active_host ? 'host' : ''}">${crest(p, p, 40)}<em>${esc(p)}</em></span>`).join('')}</div>
      <div class="cs-meta"><span class="chip live"><i class="dot"></i>Live</span><b>${esc(b.session_id)}</b><span class="muted small">Host ${esc(b.active_host)} · ${b.participant_count} creators · ${esc(b.layout)}</span></div>
    </a>`).join('')}</div>` : `<div class="empty-card reveal">${icon('users')}<p>No co-streams are live right now.</p></div>`}
</section>

<section class="section qr-cta reveal" aria-labelledby="qrcta-title">
  <div><p class="eyebrow">Dynamic QR</p><h2 class="h-display" id="qrcta-title">One code. Always the right page.</h2>
  <p class="muted">Put it on a poster, a ticket or the big screen. Before kick-off it opens the preview, during the match the live stream, after full time the replay.</p>
  ${feat ? `<a class="btn primary lg" href="/web/qr/${esc(feat.id)}">${icon('scan')} Open the live QR</a>` : ''}</div>
  ${feat ? `<a class="qr-mini" href="/web/qr/${esc(feat.id)}" aria-label="Open the QR page">${await QRCode.toString(`http://${req.get('host')}/web/qr/${feat.id}`, { type: 'svg', margin: 1, color: { dark: '#151515', light: '#f7f5ee' } })}</a>` : ''}
</section>

<footer class="site-foot">
  <div class="foot-brand"><span class="logo">${LOGO}</span><span>CLUB<b>|</b>HOUSE Live</span></div>
  <p class="muted small">Built with NestJS · PostgreSQL · Redis Streams · MediaMTX (RTMP / HLS / WebRTC) · Three.js · React Native · Selenium Grid · k6 · GitHub Actions</p>
</footer>`;
    res.type('html').send(shell('Every match, live', body, { kind: 'home', featured: feat?.id ?? null }, { bodyClass: 'page-home', module: 'home.js' }));
  };
  app.get('/', (_req, res) => res.redirect(302, '/web'));
  app.get('/web', homePage);
  app.get('/web/', homePage);

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
    const hls = key ? `http://${mediaHost(req)}:8888/live/${key}/index.m3u8` : '';
    const label = STATUS_LABEL[p.status] ?? p.status;
    const room = `chat-${id}`;
    const notice = req.path.endsWith('/notice')
      ? `<div class="notice" role="alert">This match is <b>${esc(req.query.state ?? p.status)}</b>. We'll update this page when it's rescheduled.</div>` : '';
    const body = `
${notice}
<nav class="crumbs" aria-label="Breadcrumb"><a href="/web">Home</a><span aria-hidden="true">/</span><a href="/web#matches">Matches</a><span aria-hidden="true">/</span><span>${esc(home)} vs ${esc(away)}</span></nav>
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
  <div class="scoreboard card" style="--home:${crestColor(p.home.team_id)};--away:${crestColor(p.away.team_id)}">
    <div class="sb-team">${crest(p.home.team_id, home)}<span>${esc(home)}</span></div>
    <div class="sb-mid">
      <div class="score" data-testid="live-score-banner" id="score" aria-live="polite" aria-label="Live score">${p.home.score} - ${p.away.score}</div>
      <div class="status" id="status-label">${esc(label)}</div>
    </div>
    <div class="sb-team">${crest(p.away.team_id, away)}<span>${esc(away)}</span></div>
  </div>
  <div class="actions-row">
    ${appLink(`entity/${id}`, `http://${req.get('host')}${req.originalUrl}`)}
    <a class="btn ghost" href="/web/qr/${esc(id)}">${icon('scan')} Show QR</a>
  </div>
</section>
<div class="grid2">
  ${chatPanel(room)}
  ${merchCard(product)}
</div>`;
    res.type('html').send(shell(`${home} vs ${away}`, body, { kind: 'match', matchId: id, room, hls, status: p.status }, { bodyClass: 'page-match' }));
  };

  app.get('/web/matches/:id/live', matchPage);
  app.get('/web/matches/:id/preview', matchPage);
  app.get('/web/matches/:id/vod', matchPage);
  app.get('/web/matches/:id/notice', matchPage);

  // Dynamic QR display: the code encodes the host this page was opened on, so opening it on the laptop
  // via its LAN IP gives a code any phone on the same network can scan.
  app.get('/web/qr/:id', async (req, res) => {
    const id = req.params.id as string;
    let r: any;
    try {
      r = await qr().resolve(id, { inspect: true });
    } catch {
      return res.status(404).type('html').send(shell('Not found', `<section class="card"><h1>No QR for ${esc(id)}</h1></section>`, {}));
    }
    const code = String(r.short_url).split('/q/')[1] ?? '';
    const scanUrl = `http://${req.get('host')}/q/${code}`;
    const svg = await QRCode.toString(scanUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#121212', light: '#ffffff' } });
    let title = id;
    if (r.entity_type === 'match') {
      const m = await events().loadMatch(db().pool, id);
      if (m) { const p = project(m.sport, m.match, m.events); title = `${await teamName(p.home.team_id)} vs ${await teamName(p.away.team_id)}`; }
    }
    const states = [
      ['upcoming', 'Before kick-off', 'Preview'],
      ['in_progress', 'During the match', 'Live stream'],
      ['completed', 'After full time', 'Replay'],
      ['postponed', 'Postponed or cancelled', 'Notice'],
    ];
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('host') ?? '');
    const body = `
<section class="qr-page">
  <canvas id="stadium" class="hero-canvas" aria-hidden="true"></canvas>
  <div class="hero-shade" aria-hidden="true"></div>
  <div class="qr-layout">
    <div class="qr-copy">
      <p class="kicker"><span class="dot" aria-hidden="true"></span>Dynamic QR · ${esc(r.entity_type)}</p>
      <h1 class="display">Scan to watch<br><em>${esc(title)}</em></h1>
      <p class="lead">One printed code for the whole season. On every scan our server checks the match state and sends you to the right page.</p>
      <ol class="route-list" id="route-list">
        ${states.map(([s, when, dest]) => `<li data-state="${s}" class="${r.entity_status === s || (s === 'postponed' && !['upcoming', 'in_progress', 'completed'].includes(r.entity_status)) ? 'on' : ''}"><span class="rl-when">${when}</span><span class="rl-dest">${dest}</span></li>`).join('')}
      </ol>
      <dl class="qr-facts">
        <div><dt>Short link</dt><dd><a id="qr-short" href="${esc(scanUrl)}">${esc(scanUrl.replace(/^https?:\/\//, ''))}</a></dd></div>
        <div><dt>Opens right now</dt><dd id="qr-target">${esc(r.target_route)}</dd></div>
        <div><dt>Scans</dt><dd id="qr-scans">${Number(r.scan_count) || 0}</dd></div>
      </dl>
      <div class="cta-row">
        <a class="btn ghost" href="/audit/v1/qr/${esc(id)}/export.png" download>PNG</a>
        <a class="btn ghost" href="/audit/v1/qr/${esc(id)}/export.svg" download>SVG</a>
        <a class="btn ghost" href="/audit/v1/qr/${esc(id)}/export.pdf" download>Print PDF</a>
      </div>
      ${isLocal ? `<p class="hint">Showing this on a projector? Open this page with the laptop's network address (e.g. <code>http://192.168.x.x:8080/web/qr/${esc(id)}</code>) so phones on the same Wi-Fi can scan it.</p>` : ''}
    </div>
    <div class="qr-stage">
      <div class="qr-card" id="qr-card">
        <div class="qr-code" role="img" aria-label="QR code for ${esc(scanUrl)}">${svg}</div>
        <div class="qr-caption"><span class="logo">${LOGO}</span><span>Scan with your camera</span></div>
        <span class="sheen" aria-hidden="true"></span>
      </div>
    </div>
  </div>
</section>`;
    res.type('html').send(shell(`Scan to watch ${title}`, body, { kind: 'qr', entityId: id }, { bodyClass: 'page-qr', module: 'qr.js', desc: `Scan to watch ${title} live.` }));
  });

  app.get('/web/costream/:id', async (req, res) => {
    const id = req.params.id;
    const s = await db().get('costream', id);
    if (!s) return res.status(404).type('html').send(shell('Not found', `<section class="card"><h1>Co-stream not found</h1></section>`, {}));
    const b = s.body;
    const product = await db().get('product', 'prod-jersey-001');
    const tiles = (b.active_participants as string[]).map((pid) =>
      `<li class="tile ${pid === b.active_host ? 'host' : ''}">${crest(pid, pid, 44)}<span>${esc(pid)}</span>${pid === b.active_host ? '<span class="badge">Host</span>' : ''}</li>`).join('');
    const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/web">Home</a><span aria-hidden="true">/</span><a href="/web#costreams">Co-streams</a><span aria-hidden="true">/</span><span>${esc(id)}</span></nav>
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
  <div class="actions-row">${appLink(`stream/${id}`, `http://${req.get('host')}${req.originalUrl}`)}</div>
</section>
<div class="grid2">${chatPanel(b.chat_room_id)}${merchCard(product)}</div>`;
    res.type('html').send(shell(`Co-stream ${id}`, body, { kind: 'costream', sessionId: id, room: b.chat_room_id, hls: b.composite_playback_url }, { bodyClass: 'page-costream' }));
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
