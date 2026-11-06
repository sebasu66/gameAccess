// @ts-nocheck -- Stage: prototype. Typed in the polish stage, once Seba approves the component in the app.
/**
 * <ga-mode-rail>: the current mode, written large and vertical in the first column (docs/TAREA-pantallas-y-modos.md).
 * Modes: home, games, manager, parental, settings. Everything is set by attributes (ModeRail.tsx maps the user's
 * appearance preferences onto them): font, size, orientation, position, colours, outline, a background image (a sheet
 * of vertical strips, or a sheet of header and footer caps, one per mode), custom CSS, and GSAP animations for the
 * word leaving (end) and arriving (start). Shadow DOM: the user's CSS only reaches the rail.
 * Prototype made and tried in the "GA Mode Rail" artifact; this is the same code with the app's GSAP.
 */
import { gsap, motionOk } from "../../../motion/gsap";

const SIDEWAYS = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("writing-mode", "sideways-lr");
const reduced = () => !motionOk();

/* A sheet of caps: transparent background, 2 rows (headers and footers) with the same number of columns. Each cap is
   cropped to its content, loose red specks around it are cleared, and its dominant colour is kept for the rail. */
export function analyzeCaps(img) {
  const W = img.naturalWidth, H = img.naturalHeight; if (!W || !H) return null;
  const sc = Math.min(1, 900 / Math.max(W, H)), w = Math.max(1, Math.round(W * sc)), h = Math.max(1, Math.round(H * sc));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const x = cv.getContext && cv.getContext("2d", { willReadFrequently: true }); if (!x) return null;
  x.drawImage(img, 0, 0, w, h);
  let d; try { d = x.getImageData(0, 0, w, h).data; } catch { return null; }
  const isRed = (r, g, b) => r > 120 && g < 60 && b < 60;
  const m = new Uint8Array(w * h); let opq = 0;
  for (let i = 0; i < w * h; i++) { const a = d[i * 4 + 3]; if (a > 200) { opq++; if (!isRed(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) m[i] = 1; } }
  if (opq / (w * h) > .9) return null;
  const bands = (arr, th, gap, minlen) => {
    const out = []; let st = -1;
    for (let i = 0; i <= arr.length; i++) { const on = i < arr.length && arr[i] > th; if (on && st < 0) st = i; if (!on && st >= 0) { out.push([st, i]); st = -1; } }
    const mg = []; out.forEach(b => { if (mg.length && b[0] - mg[mg.length - 1][1] < gap) mg[mg.length - 1][1] = b[1]; else mg.push(b); });
    return mg.filter(b => b[1] - b[0] >= minlen);
  };
  const G = Math.max(2, 6 * sc), L = Math.max(6, 20 * sc);
  const rowF = new Float32Array(h); for (let y = 0; y < h; y++) { let c = 0; for (let xx = 0; xx < w; xx++) c += m[y * w + xx]; rowF[y] = c / w; }
  const rows = bands(rowF, .08, G, L); if (rows.length !== 2) return null;
  const cells = rows.map(([y0, y1]) => { const f = new Float32Array(w); for (let xx = 0; xx < w; xx++) { let c = 0; for (let y = y0; y < y1; y++) c += m[y * w + xx]; f[xx] = c / (y1 - y0); } return bands(f, .2, G, L); });
  if (cells[0].length < 2 || cells[0].length !== cells[1].length) return null;
  const mid = Math.round((rows[0][1] + rows[1][0]) / 2), win = [[0, mid], [mid, h]];
  const big = b => b.reduce((p, c) => c[1] - c[0] > p[1] - p[0] ? c : p);
  const out = [[], []];
  cells.forEach((cols, ri) => cols.forEach(([x0, x1]) => {
    const [wy0, wy1] = win[ri], xa = Math.max(0, x0 - 4), xb = Math.min(w, x1 + 4);
    const rf = new Float32Array(wy1 - wy0); for (let y = wy0; y < wy1; y++) { let c = 0; for (let xx = xa; xx < xb; xx++) c += m[y * w + xx]; rf[y - wy0] = c / (xb - xa); }
    const rb = bands(rf, .03, 3, 4); if (!rb.length) return; const [ry0, ry1] = big(rb).map(v => v + wy0);
    const cf = new Float32Array(xb - xa); for (let xx = xa; xx < xb; xx++) { let c = 0; for (let y = ry0; y < ry1; y++) c += m[y * w + xx]; cf[xx - xa] = c / (ry1 - ry0); }
    const cb = bands(cf, .03, 3, 4); if (!cb.length) return; const [cx0, cx1] = big(cb).map(v => v + xa);
    const sx = Math.max(0, Math.floor(cx0 / sc)), sy = Math.max(0, Math.floor(ry0 / sc)), sw = Math.min(W - sx, Math.ceil((cx1 - cx0) / sc)), sh = Math.min(H - sy, Math.ceil((ry1 - ry0) / sc));
    const c2 = document.createElement("canvas"); c2.width = sw; c2.height = sh; const x2 = c2.getContext("2d"); x2.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const id = x2.getImageData(0, 0, sw, sh), p = id.data, bins = new Map();
    for (let i = 0; i < p.length; i += 4) {
      if (isRed(p[i], p[i + 1], p[i + 2]) && p[i + 3] > 0) { p[i + 3] = 0; continue; }
      if (p[i + 3] > 200 && p[i] + p[i + 1] + p[i + 2] < 690) { const k = (p[i] >> 5) + "." + (p[i + 1] >> 5) + "." + (p[i + 2] >> 5); const e = bins.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += p[i]; e[2] += p[i + 1]; e[3] += p[i + 2]; bins.set(k, e); }
    }
    x2.putImageData(id, 0, 0);
    let top = [1, 0, 0, 0]; bins.forEach(e => { if (e[0] > top[0]) top = e; });
    const hex = v => Math.round(v / top[0]).toString(16).padStart(2, "0");
    out[ri].push({ url: c2.toDataURL("image/png"), w: sw, h: sh, color: top[0] > 1 ? "#" + hex(top[1]) + hex(top[2]) + hex(top[3]) : "#e8661c" });
  }));
  if (out[0].length !== cells[0].length || out[1].length !== cells[0].length) return null;
  return { headers: out[0], footers: out[1], cols: cells[0].length };
}

export const RAIL_MODES = ["home", "games", "manager", "parental", "settings"];
const MODES = { home: "HOME", games: "JUEGOS", manager: "MANAGER", settings: "AJUSTES", parental: "PARENTAL" };

/* Built-in animations. Signature: (word, ctx) => tween | timeline | Promise | void; ctx = { gsap, chars, rail, mode, duration }. */
export const RAIL_PRESETS = {
  none: { start: () => {}, end: () => {} },
  slide: {
    start: (w, { gsap, duration }) => gsap.fromTo(w, { yPercent: -110 }, { yPercent: 0, duration, ease: "power4.out" }),
    end: (w, { gsap, duration }) => gsap.to(w, { yPercent: 110, duration: duration * .6, ease: "power3.in" }) },
  letters: {
    start: (w, { gsap, chars, duration }) => gsap.fromTo(chars, { xPercent: -120 }, { xPercent: 0, duration, ease: "power4.out", stagger: { each: duration * .08, from: "end" } }),
    end: (w, { gsap, chars, duration }) => gsap.to(chars, { xPercent: 120, duration: duration * .5, ease: "power3.in", stagger: { each: duration * .05, from: "start" } }) },
  wipe: {
    start: (w, { gsap, duration }) => gsap.fromTo(w, { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration, ease: "power3.inOut" }),
    end: (w, { gsap, duration }) => gsap.to(w, { clipPath: "inset(0% 0% 100% 0%)", duration: duration * .6, ease: "power3.in" }) },
  decode: {
    start: (w, { gsap, chars, duration }) => {
      const pool = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; const tl = gsap.timeline();
      chars.forEach((c, i) => { const real = c.textContent; const o = { p: 0 };
        tl.to(o, { p: 1, duration, ease: "none", onUpdate() { c.textContent = o.p < 1 ? pool[Math.random() * pool.length | 0] : real; }, onComplete() { c.textContent = real; } }, i * duration * .06); });
      return tl; },
    end: (w, { gsap, duration }) => gsap.to(w, { opacity: 0, duration: duration * .4, ease: "steps(4)" }) },
  fade: {
    start: (w, { gsap, duration }) => gsap.fromTo(w, { opacity: 0 }, { opacity: 1, duration, ease: "power1.out" }),
    end: (w, { gsap, duration }) => gsap.to(w, { opacity: 0, duration: duration * .5, ease: "power1.in" }) },
};

const BASE = `
:host{display:block;position:relative;--rail:#e8661c;--ink:#0a0705;--hazard:#0a0705;contain:layout paint}
.rail{position:absolute;inset:0;background:var(--rail);overflow:hidden;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 24px),calc(100% - 24px) 100%,0 100%)}
.bg{position:absolute;inset:0;background-repeat:no-repeat;background-size:cover;background-position:center}
.bg:not([style*="url"]){display:none}
.hazard{position:absolute;left:0;right:0;height:96px;background:repeating-linear-gradient(-45deg,var(--hazard) 0 12px,transparent 12px 26px)}
.hazard.top{top:0}.hazard.bot{bottom:0}
:host([hazard="off"]) .hazard{display:none}
:host([hazard="off"]) .stage{top:12px;bottom:28px}
.word.fill-image .char{color:transparent;-webkit-text-fill-color:transparent;-webkit-background-clip:text;background-clip:text;background-repeat:no-repeat}
.stage{position:absolute;left:0;right:0;top:112px;bottom:112px;overflow:hidden;display:flex;align-items:center;justify-content:center;z-index:3}
.word{flex:none;position:relative;white-space:nowrap;writing-mode:vertical-rl;color:var(--ink);line-height:.8;font-synthesis:none}
.word.o-up.sw{writing-mode:sideways-lr}
.word.o-up:not(.sw){transform:rotate(180deg)}
.word.o-stacked{text-orientation:upright;line-height:1;letter-spacing:-.2em}
.word.o-stacked .char{line-height:.86}
.char{display:inline-block}
.body{position:absolute;left:0;right:0;top:0;bottom:0;background:var(--rail);display:none}
.cap{position:absolute;left:0;width:100%;height:auto;display:block;pointer-events:none;z-index:2;-webkit-user-drag:none}
.cap:not([src]){display:none}
.cap.top{top:0}.cap.bot{bottom:0}
:host([data-fmt="caps"]) .rail{background:transparent;clip-path:none}
:host([data-fmt="caps"]) .body{display:block}
:host([data-fmt="caps"]) .hazard,:host([data-fmt="caps"]) .bg{display:none}
`;

/* The app's content security policy drops any <style> made at run time, so in the window the rail would have no styles
   at all (the dev server has no such policy). Constructed sheets are allowed. A <style> is only the fallback for
   environments without them (the tests' DOM). */
const SHEETS = typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype && typeof Document !== "undefined" && "adoptedStyleSheets" in Document.prototype;
const sheet = text => { const s = new CSSStyleSheet(); s.replaceSync(text); return s; };
let baseSheet = null;

class GaModeRail extends HTMLElement {
  static get observedAttributes() { return ["mode", "label", "font", "size", "css", "bg", "start", "end", "duration", "bg-strips", "bg-order", "bg-blend", "bg-contrast", "bg-brightness", "bg-saturate", "bg-opacity", "orientation", "align", "offset", "tracking", "fill", "ink", "ink-opacity", "stroke", "stroke-width", "hazard", "bg-behind", "bg-format", "rail-color"]; }
  constructor() {
    super();
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = `${SHEETS ? "" : `<style>${BASE}</style><style id="user"></style>`}
      <div class="rail" part="rail"><div class="body" part="body"></div><div class="bg" part="bg"></div>
        <div class="hazard top" part="hazard"></div><div class="stage"></div><div class="hazard bot" part="hazard"></div>
        <img class="cap top" part="cap-top" alt=""><img class="cap bot" part="cap-bottom" alt=""></div>`;
    this.$stage = r.querySelector(".stage"); this.$body = r.querySelector(".body"); this.$capT = r.querySelector(".cap.top"); this.$capB = r.querySelector(".cap.bot");
    this.$bg = r.querySelector(".bg"); this.$user = r.querySelector("#user");
    if (SHEETS) { baseSheet ??= sheet(BASE); this._userSheet = new CSSStyleSheet(); r.adoptedStyleSheets = [baseSheet, this._userSheet]; }
    this.onStart = null; this.onEnd = null; this._word = null; this._queue = Promise.resolve();
  }
  connectedCallback() {
    if (typeof ResizeObserver !== "undefined") { this._ro = new ResizeObserver(() => { this._layoutCaps(false); this._fit(); this._placeBg(false); this._paintMask(); }); this._ro.observe(this); }
    this._applyAll(); this._show(true);
    if (document.fonts) document.fonts.ready.then(() => this._fit());
  }
  disconnectedCallback() { this._ro && this._ro.disconnect(); }
  attributeChangedCallback(n, o, v) {
    if (!this.isConnected || o === v) return;
    if (n === "mode" || n === "label") { this._requestShow(); return; }
    if (n === "orientation" || n === "tracking") { this._rebuild(); return; }
    if (n === "align" || n === "offset") { this._position(); this._paintMask(); return; }
    this._applyAll();
  }
  get mode() { return this.getAttribute("mode") || "home"; }
  set mode(v) { this.setAttribute("mode", v); }
  get text() { return this.getAttribute("label") || MODES[this.mode] || this.mode.toUpperCase(); }
  get duration() { return parseFloat(this.getAttribute("duration")) || .6; }
  /** The word currently shown (tests and the settings screen read it). */
  get shownText() { return this._word ? this._word.getAttribute("aria-label") : ""; }
  _applyAll() {
    const css = this.getAttribute("css") || "";
    if (this._userSheet) this._userSheet.replaceSync(css); else this.$user.textContent = css;
    const bg = this.getAttribute("bg"), b = this.$bg;
    if (bg !== this._bgSrc) {
      this._bgSrc = bg; this._bgSize = null; this._capsData = null; b.style.backgroundImage = bg ? `url("${bg}")` : "";
      if (bg) { const im = new Image(); im.onload = () => { if (this._bgSrc === bg) { this._bgSize = [im.naturalWidth, im.naturalHeight]; this._capsData = analyzeCaps(im); this._placeBg(false); this._applyAll(); } }; im.src = bg; }
    }
    const n = (k, d) => { const v = parseFloat(this.getAttribute(k)); return isNaN(v) ? d : v; };
    b.style.mixBlendMode = this.getAttribute("bg-blend") || "normal";
    b.style.filter = `contrast(${n("bg-contrast", 1)}) brightness(${n("bg-brightness", 1)}) saturate(${n("bg-saturate", 1)})`;
    // With caps, the same image settings go to the caps and to the rail between them.
    [this.$capT, this.$capB].forEach(c => { c.style.filter = b.style.filter; c.style.mixBlendMode = b.style.mixBlendMode; c.style.opacity = n("bg-opacity", 1); });
    this.$body.style.filter = b.style.filter;
    b.style.opacity = this._fillImage && this.getAttribute("bg-behind") !== "on" ? 0 : n("bg-opacity", 1);
    this._resolveFormat();
    const rc = this.getAttribute("rail-color"); if (rc && rc !== "auto") this.style.setProperty("--rail", rc); else this.style.removeProperty("--rail");
    this._placeBg(false); this._layoutCaps(false);
    if (this._word) this._styleWord(this._word);
    this._fit(); this._paintMask();
  }
  /* strips = vertical strips, one per mode; caps = a row of headers and a row of footers (transparent background). */
  _resolveFormat() {
    const want = this.getAttribute("bg-format") || "auto", has = !!this._capsData;
    const fmt = !this.getAttribute("bg") ? "" : want === "strips" ? "strips" : has ? "caps" : "strips";
    if (fmt === "caps") this.setAttribute("data-fmt", "caps"); else this.removeAttribute("data-fmt");
    if (fmt !== this._fmt || want !== this._want) { this._fmt = fmt; this._want = want; this._emit("ga-bg-format", { format: fmt, requested: want, detected: has ? "caps" : "strips", cols: has ? this._capsData.cols : 0 }); }
  }
  _capIndex() { let i = this.bgOrder.indexOf(this.mode); if (i < 0) i = 0; return i % this._capsData.cols; }
  _layoutCaps(animate) {
    const st = this.$stage.style;
    if (this._fmt !== "caps" || !this._capsData) { st.top = st.bottom = ""; this.$capT.removeAttribute("src"); this.$capB.removeAttribute("src"); return; }
    const W = this.clientWidth; if (!W) return;
    const i = this._capIndex(), h = this._capsData.headers[i], f = this._capsData.footers[i];
    const th = W * h.h / h.w, bh = W * f.h / f.w;
    st.top = Math.round(th + 10) + "px"; st.bottom = Math.round(bh + 10) + "px";
    this.$body.style.top = Math.round(th * .5) + "px"; this.$body.style.bottom = Math.round(bh * .5) + "px";
    const rc = this.getAttribute("rail-color"), col = rc && rc !== "auto" ? rc : h.color;
    const swap = this.$capT.getAttribute("src") !== h.url;
    this.$capT.src = h.url; this.$capB.src = f.url;
    if (animate && swap && !reduced()) {
      const d = this.duration;
      gsap.fromTo(this.$capT, { yPercent: -105 }, { yPercent: 0, duration: d, ease: "power3.out" });
      gsap.fromTo(this.$capB, { yPercent: 105 }, { yPercent: 0, duration: d, ease: "power3.out", delay: d * .1 });
      gsap.to(this.$body, { backgroundColor: col, duration: d * .8, ease: "power2.inOut" });
    } else { gsap.killTweensOf([this.$capT, this.$capB, this.$body]); this.$capT.style.transform = this.$capB.style.transform = ""; this.$body.style.backgroundColor = col; }
  }
  get _railLum() {
    if (this._fmt !== "caps" || !this._capsData) return 1;
    const rc = this.getAttribute("rail-color"), c = rc && rc !== "auto" ? rc : this._capsData.headers[this._capIndex()].color;
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c); if (!m) return 1;
    const [r, g, b] = m.slice(1).map(v => parseInt(v, 16) / 255); return .2126 * r + .7152 * g + .0722 * b;
  }
  _num(k, d) { const v = parseFloat(this.getAttribute(k)); return isNaN(v) ? d : v; }
  get _fillImage() { return this.getAttribute("fill") === "image" && !!this.getAttribute("bg") && this._fmt !== "caps"; }
  /* Text as a mask: each letter shows the part of the image behind it. */
  _paintMask() {
    const w = this._word; if (!w) return; const chars = [...w.querySelectorAll(".char")];
    if (!this._fillImage || !this._bgGeom) { w.classList.remove("fill-image"); chars.forEach(c => { c.style.backgroundImage = ""; }); return; }
    w.classList.add("fill-image");
    const g = this._bgGeom, R = this.getBoundingClientRect(), k = R.width / (this.offsetWidth || 1);
    chars.forEach(c => { const r = c.getBoundingClientRect();
      c.style.backgroundImage = `url("${this._bgSrc}")`; c.style.backgroundSize = `${g.w}px ${g.h}px`;
      c.style.backgroundPosition = `${(g.x - (r.left - R.left) / k).toFixed(1)}px ${(g.y - (r.top - R.top) / k).toFixed(1)}px`; });
  }
  get bgOrder() { return (this.getAttribute("bg-order") || RAIL_MODES.join(",")).split(",").map(t => t.trim()); }
  _placeBg(animate) {
    const sz = this._bgSize, b = this.$bg; if (!sz) return;
    const W = this.clientWidth, H = this.clientHeight; if (!W || !H) return;
    const N = Math.max(1, parseInt(this.getAttribute("bg-strips")) || 1);
    let idx = N > 1 ? this.bgOrder.indexOf(this.mode) : 0; if (idx < 0 || idx >= N) idx = 0;
    const sw = sz[0] / N, s = Math.max(W / sw, H / sz[1]);
    const x = -(idx * sw * s) - (sw * s - W) / 2, y = -(sz[1] * s - H) / 2;
    b.style.backgroundSize = `${sz[0] * s}px ${sz[1] * s}px`; this._bgGeom = { w: sz[0] * s, h: sz[1] * s, x, y };
    const pos = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    if (animate && !reduced()) gsap.to(b, { backgroundPosition: pos, duration: this.duration * 1.4, ease: "power3.inOut", overwrite: true });
    else { gsap.killTweensOf(b); b.style.backgroundPosition = pos; }
  }
  _styleWord(w) {
    w.style.fontFamily = `"${this.getAttribute("font") || "Bebas Neue"}", Impact, "Arial Narrow", sans-serif`;
    const op = this._num("ink-opacity", 1), ink = this.getAttribute("ink") || (this._fmt === "caps" && this._railLum < .35 ? "#f4f1ea" : null);
    if (this._fillImage) { w.style.color = ""; w.style.filter = `contrast(${this._num("bg-contrast", 1)}) brightness(${this._num("bg-brightness", 1)}) saturate(${this._num("bg-saturate", 1)})${op < 1 ? ` opacity(${op})` : ""}`; }
    else { w.style.filter = ""; w.style.color = ink || op < 1 ? `color-mix(in srgb, ${ink || "var(--ink)"} ${(op * 100).toFixed(0)}%, transparent)` : ""; }
    const sw = this._num("stroke-width", 0); w.style.webkitTextStroke = sw > 0 ? `${sw}px ${this.getAttribute("stroke") || "#0a0705"}` : "";
    w.style.paintOrder = "stroke fill";
  }
  _make() {
    const w = document.createElement("span"); w.className = "word"; w.setAttribute("part", "word");
    w.setAttribute("role", "heading"); w.setAttribute("aria-level", "1"); w.setAttribute("aria-label", this.text);
    for (const ch of this.text) { const c = document.createElement("span"); c.className = "char"; c.setAttribute("part", "char"); c.setAttribute("aria-hidden", "true"); c.textContent = ch; w.append(c); }
    w.classList.add("o-" + this.orientation); if (this.orientation === "up" && SIDEWAYS) w.classList.add("sw");
    const tr = this.getAttribute("tracking"); if (tr !== null && tr !== "") w.style.letterSpacing = parseFloat(tr) + "em";
    this._styleWord(w); return w;
  }
  /* up = reads bottom to top, down = top to bottom (both turned), stacked = upright letters, one under the other. */
  get orientation() { const o = this.getAttribute("orientation"); return ["up", "down", "stacked"].includes(o) ? o : "up"; }
  _position() {
    const a = this.getAttribute("align"); this.$stage.style.alignItems = a === "top" ? "flex-start" : a === "bottom" ? "flex-end" : "center";
    if (this._word) this._word.style.top = (parseFloat(this.getAttribute("offset")) || 0) + "px";
  }
  _rebuild() {
    this._queue = this._queue.then(() => { const old = this._word; if (old) gsap.killTweensOf([old, ...old.children]);
      const w = this._make(); w.dataset.mode = this.mode; if (old) old.replaceWith(w); else this.$stage.append(w); this._word = w; this._fit(); this._position(); this._paintMask(); });
  }
  _fit() {
    const w = this._word; if (!w) return; const sz = this.getAttribute("size");
    if (sz && sz !== "auto") { w.style.fontSize = /^\d+(\.\d+)?$/.test(sz) ? sz + "px" : sz; return; }
    const H = this.$stage.clientHeight, W = this.$stage.clientWidth; if (!H || !W) return;
    w.style.fontSize = "100px"; const len = w.getBoundingClientRect().height, thick = w.getBoundingClientRect().width; if (!len || !thick) return;
    const sw = this._num("stroke-width", 0); w.style.fontSize = Math.floor(Math.min(100 * (H - 8 - sw * 2) / len, 100 * (W - 12 - sw * 2) / thick)) + "px";
  }
  _ctx(w) { return { gsap, chars: [...w.querySelectorAll(".char")], rail: this, mode: this.mode, duration: this.duration }; }
  _fn(kind) {
    const custom = kind === "start" ? this.onStart : this.onEnd; if (typeof custom === "function") return custom;
    return (RAIL_PRESETS[this.getAttribute(kind) || "slide"] || RAIL_PRESETS.slide)[kind];
  }
  _run(kind, w) {
    if (reduced()) return Promise.resolve();
    try { const r = this._fn(kind)(w, this._ctx(w)); return r && typeof r.then === "function" ? new Promise(res => r.then(() => res())) : Promise.resolve(); }
    catch (e) { console.error("[ga-mode-rail]", kind, e); return Promise.resolve(); }
  }
  /* A mode change sets the label and the mode one after the other: both together are one change, one animation. */
  _requestShow() {
    if (this._showPending) return;
    this._showPending = true;
    queueMicrotask(() => { this._showPending = false; this._show(false); });
  }
  _show(first) {
    this._queue = this._queue.then(async () => {
      const old = this._word, mode = this.mode;
      // Changes that queued up while the word was moving: only the last one is shown, and nothing repeats what is there.
      if (old && old.dataset.mode === mode && old.getAttribute("aria-label") === this.text) return;
      this._placeBg(!first); this._layoutCaps(!first);
      if (old) { this._emit("ga-mode-end", { mode: old.dataset.mode }); await this._run("end", old); old.remove(); }
      const w = this._make(); w.dataset.mode = mode; this.$stage.append(w); this._word = w; this._fit(); this._position(); this._paintMask();
      this._emit("ga-mode-start", { mode });
      if (!first || this.hasAttribute("animate-first")) await this._run("start", w);
      this._emit("ga-mode-ready", { mode });
    });
  }
  /** Resolves when the queued mode changes have finished (tests wait on it). */
  settled() { return Promise.resolve().then(() => this._queue); }
  _emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d, bubbles: true })); }
  replay() { if (this._word) this._run("start", this._word); }
}

export function defineModeRail() {
  if (typeof customElements !== "undefined" && !customElements.get("ga-mode-rail")) customElements.define("ga-mode-rail", GaModeRail);
}
