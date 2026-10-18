// Dynamic QR display page: stadium backdrop, a 3D card that tilts with the pointer, and live state.
// It polls the QR resolver in inspect mode (does not count as a scan), so when someone scans the code
// the counter ticks up on screen, and if the match state changes the highlighted destination moves.
import { mountStadium } from '/web/assets/stadium.js';
import { solidHeaderOnScroll, smoothAnchors } from '/web/assets/ui.js';

const canvas = document.getElementById('stadium');
let stadium = null;
try {
  stadium = canvas ? mountStadium(canvas, { orbitRadius: 84, height: 26, angle: 2.3 }) : null;
} catch (e) {
  console.warn('3D stadium unavailable', e);
}
document.body.classList.add(stadium ? 'has-webgl' : 'no-webgl');
solidHeaderOnScroll();
smoothAnchors();

const card = document.getElementById('qr-card');
const stage = card && card.parentElement;
if (stage && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty('--rx', (-y * 14).toFixed(2) + 'deg');
    card.style.setProperty('--ry', (x * 18).toFixed(2) + 'deg');
    card.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(1) + '%');
    card.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(1) + '%');
  });
  stage.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
}

const id = (window.NASCON || {}).entityId;
const scans = document.getElementById('qr-scans');
const target = document.getElementById('qr-target');
const list = document.getElementById('route-list');
let count = Number(scans && scans.textContent) || 0;
const KNOWN = ['upcoming', 'in_progress', 'completed'];

async function poll() {
  try {
    const r = await fetch('/audit/v1/qr/' + encodeURIComponent(id) + '?inspect=true', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      if (d.scan_count > count) {
        count = d.scan_count;
        scans.textContent = String(count);
        scans.classList.remove('bump'); void scans.offsetWidth; scans.classList.add('bump');
        card.classList.remove('scanned'); void card.offsetWidth; card.classList.add('scanned');
        if (stadium) stadium.celebrate('#f4d35c');
      }
      target.textContent = d.target_route;
      list.querySelectorAll('li').forEach((li) => {
        const s = li.dataset.state;
        li.classList.toggle('on', s === d.entity_status || (s === 'postponed' && !KNOWN.includes(d.entity_status)));
      });
    }
  } catch (e) { /* offline: keep the last known state */ }
  setTimeout(poll, 2500);
}
if (id && scans && target && list) poll();
