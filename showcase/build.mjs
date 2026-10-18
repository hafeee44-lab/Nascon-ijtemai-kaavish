// Builds the static CLUB|HOUSE Live showcase for Vercel from a running local stack.
//   node showcase/build.mjs [siteHost]      (default clubhouse-live.vercel.app)
// It crawls the server-rendered /web pages (with Host set to the public site, so QR codes point there),
// swaps the live HLS feed for a recorded clip, injects demo.js, copies assets, and writes vercel.json
// with /q/{code} → page redirects so the printed QR codes work on the static site too.
import http from 'node:http';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(here, 'dist');
const SITE = process.argv[2] || 'clubhouse-live.vercel.app';
const API = { host: '127.0.0.1', port: 8080 };
const QRCode = createRequire(join(root, 'backend', 'package.json'))('qrcode');

const get = (path, host = SITE) => new Promise((resolve, reject) => {
  http.get({ ...API, path, headers: { Host: host } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  }).on('error', reject);
});

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. crawl /web pages
const seen = new Set(), queue = ['/web'], pages = new Map();
while (queue.length) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  const r = await get(path);
  if (r.status !== 200) { console.warn('skip', path, r.status); continue; }
  pages.set(path, r.body);
  for (const [, href] of r.body.matchAll(/href="(\/web\/[^"#?]*)"/g)) {
    if (!href.startsWith('/web/assets') && !seen.has(href)) queue.push(href);
  }
}

// 2. QR data for every QR page (short code → destination) and downloadable images
const qrInfo = {}, redirects = [{ source: '/', destination: '/web', permanent: false }];
for (const path of pages.keys()) {
  const m = path.match(/^\/web\/qr\/([^/]+)$/);
  if (!m) continue;
  const q = JSON.parse((await get(`/audit/v1/qr/${m[1]}?inspect=true`)).body);
  const code = q.short_url.split('/q/')[1];
  qrInfo[m[1]] = { status: q.entity_status, target: q.target_route, code };
  redirects.push({ source: `/q/${code}`, destination: q.target_route, permanent: false });
  const url = `https://${SITE}/q/${code}`;
  const dir = join(OUT, 'web', 'qr', m[1]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'qr.png'), await QRCode.toBuffer(url, { type: 'png', margin: 2, width: 1024, errorCorrectionLevel: 'H' }));
  writeFileSync(join(dir, 'qr.svg'), await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'H' }));
}

// 3. rewrite + write pages
const demoBoot = `<link rel="stylesheet" href="/web/assets/demo.css"><script>window.DEMO_QR=${JSON.stringify(qrInfo)};</script><script src="/web/assets/demo.js"></script>`;
for (const [path, html] of pages) {
  const id = (path.match(/^\/web\/qr\/([^/]+)$/) || [])[1];
  const out = html
    .replace('<head>', `<head>\n${demoBoot}`)
    .replace(/data-src="[^"]*(?:\.m3u8|\/live\/[^"]*)"/g, 'data-src="/web/assets/media/broadcast.mp4"')
    .replace(/http:\/\/[^"<\s]*:8888\/[^"<\s]*/g, '/web/assets/media/broadcast.mp4')
    .replace(new RegExp(`http://${SITE.replace(/\./g, '\\.')}`, 'g'), `https://${SITE}`)
    .replace(/href="\/audit\/v1\/qr\/[^/]+\/export\.png" download/g, 'href="qr.png" download')
    .replace(/href="\/audit\/v1\/qr\/[^/]+\/export\.svg" download/g, 'href="qr.svg" download')
    .replace(/<a class="btn ghost" href="\/audit\/v1\/qr\/[^/]+\/export\.pdf" download>Print PDF<\/a>/g, '<a class="btn ghost" href="#" onclick="window.print();return false">Print</a>');
  const file = join(OUT, path.replace(/^\//, ''), 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, id ? out.replace(/href="qr\.(png|svg)"/g, `href="/web/qr/${id}/qr.$1"`) : out);
  console.log('page', path);
}

// 4. assets
const assets = join(OUT, 'web', 'assets');
cpSync(join(root, 'backend', 'src', 'web', 'assets'), assets, { recursive: true });
cpSync(join(root, 'backend', 'src', 'web', 'player.css'), join(assets, 'player.css'));
cpSync(join(root, 'backend', 'src', 'web', 'player.js'), join(assets, 'player.js'));
cpSync(join(here, 'demo.js'), join(assets, 'demo.js'));
const clip = join(here, 'media', 'broadcast.mp4');
if (existsSync(clip)) { mkdirSync(join(assets, 'media'), { recursive: true }); cpSync(clip, join(assets, 'media', 'broadcast.mp4')); }
writeFileSync(join(assets, 'demo.css'), readFileSync(join(here, 'demo.css'), 'utf8'));

// 5. vercel.json
writeFileSync(join(OUT, 'vercel.json'), JSON.stringify({
  cleanUrls: true,
  trailingSlash: false,
  redirects,
  headers: [
    { source: '/web/assets/(vendor|fonts|img|media)/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
  ],
}, null, 2));
console.log(`built ${pages.size} pages for https://${SITE} → ${OUT}`);
