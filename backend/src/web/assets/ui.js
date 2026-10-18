// Small shared UI behaviours for the CLUB|HOUSE web pages.

// Fade sections in as they scroll into view. Elements already on screen are shown immediately,
// so nothing flashes, and everything stays visible if this script never runs.
export function revealOnScroll() {
  const els = Array.from(document.querySelectorAll('.reveal'));
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const vh = window.innerHeight;
  els.forEach((el) => { if (el.getBoundingClientRect().top < vh * 0.92) el.classList.add('in'); });
  document.documentElement.classList.add('reveal-ready');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => { if (!el.classList.contains('in')) io.observe(el); });
}

// The header floats over the hero and turns solid once the page scrolls.
export function solidHeaderOnScroll() {
  const top = document.querySelector('.top');
  if (!top) return;
  const update = () => top.classList.toggle('scrolled', window.scrollY > 24);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

// Smooth-scroll only for same-page anchor links (e.g. the scroll cue and the header nav on the home page).
export function smoothAnchors() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href*="#"]');
    if (!a || a.pathname !== location.pathname) return;
    const el = document.getElementById(decodeURIComponent(a.hash.slice(1)));
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', a.hash);
  });
}
