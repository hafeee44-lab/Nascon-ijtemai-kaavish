// Home page: Three.js stadium hero, scroll reveals, and the featured match's live score over SSE.
// A real goal (score change pushed by the API) triggers a confetti burst in the scoring team's colour.
import { mountStadium } from '/web/assets/stadium.js';
import { revealOnScroll, solidHeaderOnScroll, smoothAnchors } from '/web/assets/ui.js';

const canvas = document.getElementById('stadium');
let stadium = null;
try {
  stadium = canvas ? mountStadium(canvas) : null;
} catch (e) {
  console.warn('3D stadium unavailable', e);
}
document.body.classList.add(stadium ? 'has-webgl' : 'no-webgl');

revealOnScroll();
solidHeaderOnScroll();
smoothAnchors();

const card = document.getElementById('hero-card');
const scoreEl = document.getElementById('hero-score');
if (card && scoreEl && window.EventSource) {
  const id = card.dataset.match;
  let last = scoreEl.textContent.trim();
  const goals = (s) => s.split('-').map((x) => parseInt(x, 10) || 0);
  const es = new EventSource('/api/v1/matches/' + encodeURIComponent(id) + '/stream');
  window.addEventListener('pagehide', () => es.close());
  es.addEventListener('score', (e) => {
    const s = JSON.parse(e.data);
    if (!s || s.score === undefined || s.score === last) return;
    const [h, a] = goals(s.score), [ph, pa] = goals(last);
    const colour = h > ph ? card.dataset.homeColor : a > pa ? card.dataset.awayColor : '#f4d35c';
    last = s.score;
    scoreEl.textContent = s.score;
    card.style.setProperty('--goal', colour);
    card.classList.remove('goal');
    void card.offsetWidth; // restart the CSS animation
    card.classList.add('goal');
    if (stadium) stadium.celebrate(colour);
    document.querySelectorAll('.mcard[href^="/web/matches/' + id + '/"] .mc-score').forEach((el) => { el.textContent = s.score; });
  });
}
