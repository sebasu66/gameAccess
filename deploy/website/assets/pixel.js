// Pixel field and orange LED material of the Game Access app (apps/desktop/src/referencePixelEffects.js),
// same rendering functions and default style, without the app's React and settings adapter.
// Background: every element is a 4 px dark pixel that blinks slowly. Buttons with class "led": orange 3 px LEDs.
(() => {
const px = 4, dpr = Math.min(devicePixelRatio || 1, 2);
const P = { spd: 1, cob: 1, blink: 1, ovar: 1.4, oled: 1, glass: .85, animate: true }; // DEFAULT_PIXEL_STYLE
const media = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hash = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
const vn = (x, y, s) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const L = (i, j) => hash(i * 1.7 + s * 31.1, j * 2.3 + s * 7.7);
  const a = L(xi, yi), b = L(xi + 1, yi), c = L(xi, yi + 1), d = L(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

/* ---------- Background: dark pixels that blink slowly ---------- */
const field = document.createElement('div'); field.id = 'pixel-field'; field.setAttribute('aria-hidden', 'true');
const fcv = document.createElement('canvas'); field.append(fcv); document.body.prepend(field);
const fctx = fcv.getContext('2d');
let W, H, cols, rows, N, img, u32, bR, bG, bB, bp, gL, cb, jt, sp, cl, off, kc, ev;
function build() {
  W = Math.max(1, innerWidth); H = Math.max(1, innerHeight);  // a hidden or not yet laid out window reports 0
  cols = Math.ceil(W / px); rows = Math.ceil(H / px); N = cols * rows;
  fcv.width = cols; fcv.height = rows; fcv.style.width = cols * px + 'px'; fcv.style.height = rows * px + 'px';
  img = fctx.createImageData(cols, rows); u32 = new Uint32Array(img.data.buffer);
  bR = new Uint8Array(N); bG = new Uint8Array(N); bB = new Uint8Array(N); bp = new Uint32Array(N);
  gL = new Float32Array(N); cb = new Float32Array(N); jt = new Float32Array(N); sp = new Uint8Array(N);
  cl = new Float32Array(N); off = new Float32Array(N); kc = new Int32Array(N).fill(-1); ev = new Uint8Array(N);
  for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) {
    const n1 = .6 * vn(x * .018, y * .018, 21) + .4 * vn(x * .07, y * .07, 22);
    const n2 = vn(x * .012 + 5, y * .014, 23);
    gL[i] = clamp((n1 - .2) / .6, 0, 1);
    cb[i] = Math.pow(clamp((n2 - .5) * 2.4, 0, 1), 1.3);
    jt[i] = hash(x * 1.9, y * 2.3 + 3);
    sp[i] = hash(x * 2.1 + 4, y * 1.1) < .018 ? 1 : 0;
    cl[i] = 5 + 11 * hash(x * .9, y * 1.3 + 7); off[i] = cl[i] * hash(x * 1.7 + 1, y * .6);
  }
  for (let i = 0; i < N; i++) {
    const base = 10 + 14 * gL[i] + (jt[i] - .5) * 3 + (sp[i] ? 14 : 0), c = cb[i] * P.cob;
    const r = clamp(base - 3 * c, 0, 255) | 0, g = clamp(base + 7 * c, 0, 255) | 0, b = clamp(base + 2 + 36 * c, 0, 255) | 0;
    bR[i] = r; bG[i] = g; bB[i] = b; bp[i] = (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
}
const EV = .55;
function paintField(t) {
  for (let i = 0; i < N; i++) {
    const q = (t + off[i]) / cl[i], k = Math.floor(q), u = q - k;
    if (k !== kc[i]) { kc[i] = k; const r = hash(i, k); ev[i] = r < .07 * P.blink ? 1 : r < .12 * P.blink ? 2 : 0; }
    const e = ev[i];
    if (e === 0 || u >= EV) { u32[i] = bp[i]; continue; }
    const p = Math.sin(Math.PI * u / EV);
    let r, g, b;
    if (e === 1) { const f = 1 - .85 * p; r = bR[i] * f; g = bG[i] * f; b = bB[i] * f; }
    else { const a = 24 * p; r = bR[i] + a * .8; g = bG[i] + a * .9; b = bB[i] + a * 1.25; }
    u32[i] = (0xFF000000 | ((b > 255 ? 255 : b | 0) << 16) | ((g > 255 ? 255 : g | 0) << 8) | (r > 255 ? 255 : r | 0)) >>> 0;
  }
  fctx.putImageData(img, 0, 0);
}

/* ---------- Orange LEDs: light/dark range and flicker ---------- */
const orange = o => { let r, g, b; if (o < .5) { const k = o * 2; r = 110 + 122 * k; g = 36 + 76 * k; b = 6 * k; } else { const k = (o - .5) * 2; r = 232 + 23 * k; g = 112 + 88 * k; b = 6 + 74 * k * k; } return `rgb(${r | 0},${g | 0},${b | 0})`; };
const CELL = 3, EVL = .4;
function pixelSet(w, h) {
  const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL), n = cw * ch, sd = Math.floor(Math.random() * 500);
  const s = { cw, ch, sd, a: new Float32Array(n), b: new Float32Array(n), j: new Float32Array(n), w: new Float32Array(n), p: new Float32Array(n), cl: new Float32Array(n), off: new Float32Array(n), kc: new Int32Array(n).fill(-1), ev: new Uint8Array(n) };
  for (let y = 0, i = 0; y < ch; y++) for (let x = 0; x < cw; x++, i++) {
    s.a[i] = vn(x * .12, y * .12, sd); s.b[i] = vn(x * .4, y * .4, sd + 3);
    s.j[i] = hash(x * 1.7 + sd, y * 2.9); s.w[i] = .2 + .5 * hash(x, y + sd); s.p[i] = 6.283 * hash(x + 3, y * 1.3);
    s.cl[i] = 1.4 + 3.2 * hash(x * .8 + sd, y * 1.9 + 5); s.off[i] = s.cl[i] * hash(x * 1.3 + 7, y * .9 + sd);
  }
  return s;
}
function tone(s, i, t) {
  const V = P.ovar, L = P.oled;
  let o = .5 + ((.6 * s.a[i] + .4 * s.b[i] - .5) + (s.j[i] - .5) * .55 + .05 * Math.sin(t * s.w[i] + s.p[i])) * V;
  const q = (t + s.off[i]) / s.cl[i], k = Math.floor(q), u = q - k;
  if (k !== s.kc[i]) { s.kc[i] = k; const r = hash(i + s.sd, k); s.ev[i] = r < .12 * L ? 1 : r < .26 * L ? 2 : 0; }
  const e = s.ev[i];
  if (e && u < EVL) { const p = Math.sin(Math.PI * u / EVL); o += (e === 1 ? -.5 : .4) * p * Math.min(L, 1.5); }
  return clamp(o, 0, 1);
}
const leds = [];
function addLed(el) {
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); el.prepend(canvas);
  const o = { el, canvas, c: canvas.getContext('2d'), s: null, w: 0, h: 0 };
  const size = () => {
    const w = el.clientWidth, h = el.clientHeight; if (!w || !h || (w === o.w && h === o.h)) return;
    o.w = w; o.h = h; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); o.s = pixelSet(w, h);
  };
  new ResizeObserver(size).observe(el); size(); leds.push(o);
}
function drawLeds(t) {
  for (const o of leds) {
    if (!o.s) continue;
    o.c.setTransform(dpr, 0, 0, dpr, 0, 0); o.c.fillStyle = '#7A2A00'; o.c.fillRect(0, 0, o.w, o.h);
    for (let y = 0, i = 0; y < o.s.ch; y++) for (let x = 0; x < o.s.cw; x++, i++) {
      o.c.fillStyle = orange(tone(o.s, i, t)); o.c.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
    }
  }
}

document.documentElement.style.setProperty('--glass', P.glass);
document.querySelectorAll('.led').forEach(addLed);
build();
let last = performance.now(), tt = media.matches ? 3 : 0, lp = -1e3, lq = -1e3, fieldMs = 4, dirty = true;
function loop(now) {
  const dt = Math.max(0, (now - last) / 1000); last = now;
  const animated = P.animate && !media.matches;
  if (animated && document.visibilityState === 'visible') tt += dt * P.spd;
  if (document.visibilityState === 'visible' && (animated || dirty)) {
    if (dirty || now - lp > Math.max(90, fieldMs * 10)) { const began = performance.now(); lp = now; paintField(tt); fieldMs = fieldMs * .8 + (performance.now() - began) * .2; }
    if (dirty || now - lq > 60) { lq = now; drawLeds(tt); }
    dirty = false;
  }
  requestAnimationFrame(loop);
}
addEventListener('resize', () => { build(); dirty = true; });
document.addEventListener('visibilitychange', () => { last = performance.now(); dirty = true; });
requestAnimationFrame(loop);
})();
