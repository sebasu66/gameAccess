// Header behaviour.
// - The header gets its glass background once the page scrolls.
// - The logo docks like in the app (apps/desktop/public/brand/logo-to-header.webm): when the big logo starts to slide
//   under the header, the app's film plays on top of the page — the G breaks into cubes that fly to the header — while
//   the big name erases itself; then the header logo appears and its name writes itself. Scrolling back up plays the
//   same film reversed (logo-from-header.webm), from the header back to the big logo.
//   The films are moved and scaled frame by frame so they start and end exactly on the two logos.
(() => {
const header = document.querySelector('.site-header');
const heroVideo = document.querySelector('.hero-logo .logo-loop');
const bigName = document.querySelector('.wordmark-big');
const brandVideo = document.querySelector('.brand .logo-loop');
const toHeader = document.querySelector('.dock-film.to-header');
const fromHeader = document.querySelector('.dock-film.from-header');
if (!header) return;
const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 12);
addEventListener('scroll', onScroll, { passive: true }); onScroll();
if (!heroVideo || !brandVideo || !('IntersectionObserver' in window)) { header.classList.add('show-brand'); return; }

// Where the G is inside each video, measured on their frames: big logo at the start of logo-to-header.webm, small
// logo at its end, and the share of a logo box that the G fills in the loop videos.
const BIG = { x: 959.5, y: 540, h: 499 }, SMALL = { x: 63.5, y: 53.5, h: 48 }, G_SHARE = .67;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || !toHeader || !fromHeader;
let state = 'hero', frame = 0, film = null;

function box(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height * G_SHARE }; }
// p = 0..1 along the film; `start`/`end` say where the film's own logo is at its first and last frame.
function place(el, p, start, end, from, to) {
  const s0 = from.h / start.h, s1 = to.h / end.h;
  const a = { x: from.x - start.x * s0, y: from.y - start.y * s0 }, b = { x: to.x - end.x * s1, y: to.y - end.y * s1 };
  el.style.transform = `translate(${a.x + (b.x - a.x) * p}px, ${a.y + (b.y - a.y) * p}px) scale(${s0 * Math.pow(s1 / s0, p)})`;
}
function track() {
  if (!film) return;
  const p = film.duration ? Math.min(film.currentTime / film.duration, 1) : 0;
  // The ends follow the logos, which keep moving while the page scrolls.
  if (film === toHeader) place(toHeader, p, BIG, SMALL, box(heroVideo), box(brandVideo));
  else place(fromHeader, p, SMALL, BIG, box(brandVideo), box(heroVideo));
  frame = requestAnimationFrame(track);
}
function stopFilm() {
  cancelAnimationFrame(frame);
  if (film) { film.pause(); film.classList.remove('is-playing'); film.onended = null; }
  film = null;
}
function playFilm(el, done) {
  stopFilm();
  film = el;
  el.currentTime = 0; el.classList.add('is-playing');
  el.onended = () => { stopFilm(); done(); };
  track();
  el.play().catch(() => { stopFilm(); done(); });
}

function showBig() { heroVideo.classList.remove('is-away'); bigName?.classList.remove('is-erased'); }
function hideBig() { heroVideo.classList.add('is-away'); bigName?.classList.add('is-erased'); }
function docked() { state = 'docked'; header.classList.add('show-brand'); }
function home() { state = 'hero'; showBig(); }

function dock(instant) {
  state = 'docking'; hideBig(); header.classList.remove('show-brand');
  if (instant || reduced) { stopFilm(); docked(); return; }
  playFilm(toHeader, docked);
}
function undock() {
  state = 'undocking'; header.classList.remove('show-brand');
  if (reduced) { stopFilm(); home(); return; }
  playFilm(fromHeader, home);
}

// The film to the header starts as soon as the big logo begins to slide under the header; the way back starts once
// the big logo's place is whole again (the gap between both avoids flicker at the edge).
const headerHeight = () => header.getBoundingClientRect().height;
let observer;
function observe() {
  observer?.disconnect();
  observer = new IntersectionObserver(([entry]) => {
    const ratio = entry.intersectionRatio;
    if (ratio < .9 && (state === 'hero' || state === 'undocking')) {
      // Opened already scrolled down (reload, link to a section): no film, the logo is simply in the header.
      dock(state === 'hero' && entry.boundingClientRect.bottom < headerHeight());
    } else if (ratio > .99 && (state === 'docked' || state === 'docking')) {
      if (state === 'docking') { stopFilm(); home(); } else undock();
    }
  }, { rootMargin: `-${Math.round(headerHeight())}px 0px 0px 0px`, threshold: [0, .5, .9, .95, .99, 1] });
  observer.observe(heroVideo);
}
observe();
addEventListener('resize', observe);
})();

// The looping logos rest when the page is not being looked at: when the window loses focus, the tab is hidden or the
// pointer leaves the page, the still G fades in over the loop, and only then the loop pauses and goes back to its
// first frame (which is that same G). When the page is back, the loop plays again and the still fades out.
(() => {
const loops = [...document.querySelectorAll('.logo-loop')].map(box => ({ box, video: box.querySelector('video') })).filter(l => l.video);
if (!loops.length) return;
const FADE_MS = 600;
let resting = false, pauseTimer = 0;
function rest() {
  if (resting) return;
  resting = true;
  for (const l of loops) l.box.classList.add('is-still');
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => { for (const l of loops) { l.video.pause(); l.video.currentTime = 0; } }, FADE_MS);
}
function wake() {
  if (!resting || document.visibilityState !== 'visible') return;
  resting = false; clearTimeout(pauseTimer);
  for (const l of loops) {
    const reveal = () => { if (!resting) l.box.classList.remove('is-still'); };
    l.video.play().then(() => requestAnimationFrame(reveal)).catch(reveal);
  }
}
addEventListener('blur', rest);
addEventListener('focus', wake);
document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? wake() : rest()));
document.documentElement.addEventListener('mouseleave', rest);
document.documentElement.addEventListener('mouseenter', wake);
})();
