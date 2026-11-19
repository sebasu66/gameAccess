/**
 * <game-access-hdd> · Game Access
 * Reusable Web Component for Tauri/web. No framework required.
 * Animations run with GSAP 3 (pass window.gsap through your app entrypoint).
 *
 * Public API:
 *   disk.setData({ letter, label, totalBytes, usedBytes, activity, status });
 *   disk.setActivity('idle' | 'reading' | 'writing');
 *   disk.setUsage(usedBytes, totalBytes);
 *   disk.pause() / disk.resume();
 */

const ASSETS = {
  body: new URL('../assets/hdd-body.png', import.meta.url).href,
  platter: new URL('../assets/hdd-platter.png', import.meta.url).href,
  head: new URL('../assets/hdd-head.png', import.meta.url).href,
};

const COLORS = {
  normal: '#35c8e7',
  warning: '#ffbe54',
  critical: '#ff5674',
};

const CSS = `
  :host {
    display: block;
    min-width: 0;
    width: 100%;
    contain: layout style;
    --ga-status: #35c8e7;
    font-family: Inter, 'Segoe UI', system-ui, sans-serif;
    color: #f5edf1;
  }
  :host([hidden]) { display: none; }
  *, *::before, *::after { box-sizing: border-box; }
  .disk {
    width: 100%; aspect-ratio: 3 / 1;
    position: relative; isolation: isolate;
    filter: drop-shadow(0 7px 10px rgba(0,0,0,.35));
    user-select: none;
  }
  .disk img { display: block; pointer-events: none; }
  .body { position: absolute; z-index: 1; inset: 0; width: 100%; height: 100%; }
  /* The art was aligned at the native 2172x724 resolution. */
  .platter {
    position: absolute; z-index: 2;
    left: 10.82%; top: 10.77%; width: 22%; height: auto;
    transform-origin: 50% 50%; will-change: transform;
  }
  .head {
    position: absolute; z-index: 3;
    left: 5.75%; top: 38.26%; width: 20.26%; height: auto;
    transform-origin: 35% 61%; will-change: transform;
  }
  .accent {
    position: absolute; z-index: 4; pointer-events: none;
    left: 36.4%; top: 11.5%; height: 75%; width: .18%;
    border-radius: 99px;
    background: var(--ga-status);
    box-shadow: 0 0 10px var(--ga-status);
    opacity: .42;
  }
  .panel {
    position: absolute; z-index: 5;
    left: 37.35%; top: 13%; width: 50.6%; height: 72%;
    overflow: visible;
  }
  svg text { font-family: Inter, 'Segoe UI', system-ui, sans-serif; }
  .micro { font-size: 24px; font-weight: 800; letter-spacing: 4px; fill: #b69fa9; }
  .unit { font-size: 116px; font-weight: 900; fill: #f5eef2; letter-spacing: -5px; }
  .label { font-size: 62px; font-weight: 850; fill: #f4eaf0; letter-spacing: -1.5px; }
  .percent { font-size: 85px; font-weight: 850; fill: var(--ga-status); letter-spacing: -3px; }
  .data-caption { font-size: 28px; font-weight: 750; fill: #bdaab4; letter-spacing: 3px; }
  .value { font-size: 45px; font-weight: 750; fill: #f5edf1; }
  .secondary { font-size: 32px; font-weight: 680; fill: #c8b8c3; }
  .capacity { font-size: 32px; font-weight: 700; fill: #d8cbd0; }
  .activity { font-size: 25px; font-weight: 750; letter-spacing: 3px; fill: #d6bfc8; }
  .fill { fill: var(--ga-status); }
  .ring { stroke: var(--ga-status); }
  .led { fill: var(--ga-status); }
  @media (prefers-reduced-motion: reduce) {
    .platter, .head { will-change: auto; }
  }
`;

const N = value => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

function formatBytes(value) {
  const n = N(value);
  if (!n) return '0 GB';
  const steps = ['B','KB','MB','GB','TB','PB'];
  const unit = Math.min(steps.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const num = n / 1000 ** unit;
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: num >= 100 ? 0 : 1 }).format(num) + ' ' + steps[unit];
}

function makeMarkup() {
  const ticks = Array.from({ length: 29 }, (_, i) =>
    `<path d="M ${212 + i * 29} 365 v 48" stroke="#ffeaf3" stroke-opacity=".13" stroke-width="2" />`
  ).join('');
  return `
    <style>${CSS}</style>
    <div class="disk" part="disk" role="group">
      <img class="body" part="body" src="${ASSETS.body}" alt="" draggable="false" />
      <img class="platter" part="platter" src="${ASSETS.platter}" alt="" draggable="false" />
      <img class="head" part="head" src="${ASSETS.head}" alt="" draggable="false" />
      <div class="accent"></div>
      <svg class="panel" part="panel" viewBox="0 0 1100 500" preserveAspectRatio="xMidYMid meet" role="img" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="trackBg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#112a33"/><stop offset="100%" stop-color="#1c2932"/>
          </linearGradient>
          <linearGradient id="usedOverlay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff" stop-opacity=".20"/>
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
          </linearGradient>
          <clipPath id="barClip"><rect x="212" y="365" width="836" height="48" rx="12" /></clipPath>
        </defs>
        <rect x="4" y="50" width="174" height="222" rx="18" fill="#0b1018" fill-opacity=".52" stroke="#766a78" stroke-opacity=".65" stroke-width="3"/>
        <path d="M 18 64 h 45 M 165 251 h -45" stroke="var(--ga-status)" stroke-width="5" opacity=".85" />
        <text class="unit" x="88" y="196" text-anchor="middle" data-unit>C:</text>
        <text class="micro" x="213" y="77">UNIDAD / VOLUMEN</text>
        <text class="label" x="209" y="151" data-label>SISTEMA</text>
        <text class="micro" x="213" y="197">ALMACENAMIENTO LOCAL</text>
        <text class="percent" x="1050" y="233" text-anchor="end" data-percent>0%</text>
        <path d="M 213 224 h 835" stroke="#a18c98" stroke-opacity=".25" stroke-width="3"/>
        <text class="data-caption" x="213" y="285">OCUPADO</text>
        <text class="value" x="213" y="338" data-used>0 GB</text>
        <text class="data-caption" x="680" y="285">LIBRE</text>
        <text class="value" x="680" y="338" data-free>0 GB</text>
        <rect x="212" y="365" width="836" height="48" rx="12" fill="url(#trackBg)" stroke="#537080" stroke-opacity=".5" stroke-width="3" />
        <g clip-path="url(#barClip)">
          <rect class="fill" x="212" y="365" width="0" height="48" data-progress />
          <rect x="212" y="365" width="836" height="48" fill="url(#usedOverlay)" />
          ${ticks}
        </g>
        <text class="capacity" x="213" y="481" data-total>CAPACIDAD: 0 GB</text>
        <circle class="led" cx="876" cy="469" r="9" data-led/>
        <text class="activity" x="901" y="478" data-activity>EN REPOSO</text>
      </svg>
    </div>
  `;
}

class GameAccessHdd extends HTMLElement {
  static get observedAttributes() { return ['letter', 'label', 'total', 'used', 'activity', 'status']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = makeMarkup();
    this._els = {
      disk: this.shadowRoot.querySelector('.disk'),
      platter: this.shadowRoot.querySelector('.platter'),
      head: this.shadowRoot.querySelector('.head'),
      panel: this.shadowRoot.querySelector('.panel'),
      unit: this.shadowRoot.querySelector('[data-unit]'),
      label: this.shadowRoot.querySelector('[data-label]'),
      percent: this.shadowRoot.querySelector('[data-percent]'),
      used: this.shadowRoot.querySelector('[data-used]'),
      free: this.shadowRoot.querySelector('[data-free]'),
      total: this.shadowRoot.querySelector('[data-total]'),
      bar: this.shadowRoot.querySelector('[data-progress]'),
      led: this.shadowRoot.querySelector('[data-led]'),
      activity: this.shadowRoot.querySelector('[data-activity]'),
    };
    this._initialized = false;
    this._paused = false;
    this._activityMode = 'idle';
    this._count = { value: 0 };
    this._lastPercent = null;
    this._reduceMotion = typeof matchMedia !== 'undefined'
      ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._onReduced = () => this._applyActivity();
  }

  connectedCallback() {
    if (!this._initialized) {
      this._initialized = true;
      this._reduceMotion?.addEventListener?.('change', this._onReduced);
    }
    this._render(false);
    this._applyActivity();
  }

  disconnectedCallback() {
    this._stopAnimations();
    this._reduceMotion?.removeEventListener?.('change', this._onReduced);
    this._initialized = false;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isConnected || oldValue === newValue || this._batching) return;
    if (name === 'activity') this._applyActivity();
    else this._render(true);
  }

  /** Supply complete or partial state; values of totalBytes/usedBytes are raw bytes. */
  setData(data = {}) {
    this._batching = true;
    const names = { letter: 'letter', label: 'label', totalBytes: 'total', usedBytes: 'used', activity: 'activity', status: 'status' };
    try {
      for (const [key, attr] of Object.entries(names)) {
        if (data[key] !== undefined && data[key] !== null) this.setAttribute(attr, String(data[key]));
      }
    } finally { this._batching = false; }
    if (this.isConnected) { this._render(true); this._applyActivity(); }
  }

  setUsage(usedBytes, totalBytes = undefined) {
    this.setData({ usedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
  }

  setActivity(activity = 'idle') {
    this.setAttribute('activity', activity);
  }

  pause() { this._paused = true; this._applyActivity(); }
  resume() { this._paused = false; this._applyActivity(); }

  _render(animate) {
    const e = this._els;
    const letter = (this.getAttribute('letter') || 'C:').trim().toUpperCase();
    const displayLetter = /^[A-Z]$/.test(letter) ? letter + ':' : letter.slice(0, 3);
    const label = (this.getAttribute('label') || 'SIN ETIQUETA').trim();
    const total = N(this.getAttribute('total'));
    const used = Math.min(total, N(this.getAttribute('used')));
    const free = Math.max(0, total - used);
    const pct = total > 0 ? used / total * 100 : 0;
    const severity = this.getAttribute('status') || (pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'normal');
    const color = COLORS[severity] || COLORS.normal;

    this.style.setProperty('--ga-status', color);
    e.unit.textContent = displayLetter;
    e.label.textContent = label.length > 24 ? label.slice(0, 23) + '…' : label;
    e.label.style.fontSize = (label.length > 19 ? 45 : label.length > 15 ? 53 : 62) + 'px';
    // Reserve the right side for the large occupancy percentage.
    if (label.length > 14) {
      e.label.setAttribute('textLength', '515');
      e.label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    } else {
      e.label.removeAttribute('textLength');
      e.label.removeAttribute('lengthAdjust');
    }
    e.used.textContent = formatBytes(used);
    e.free.textContent = formatBytes(free);
    e.total.textContent = 'CAPACIDAD: ' + formatBytes(total);
    e.panel.setAttribute('aria-label', `Unidad ${displayLetter}, ${label}, ${pct.toFixed(0)} por ciento ocupado. ${formatBytes(free)} libres de ${formatBytes(total)}.`);
    e.disk.setAttribute('aria-label', `Disco ${displayLetter}, ${label}`);

    const nextWidth = Math.max(0, Math.min(836, 836 * pct / 100));
    const gsap = globalThis.gsap;
    const canTween = Boolean(animate && this._lastPercent !== null && gsap && !this._reduceMotion?.matches);
    if (canTween) {
      gsap.killTweensOf(e.bar);
      gsap.killTweensOf(this._count);
      gsap.to(e.bar, { attr: { width: nextWidth }, duration: .75, ease: 'power2.out' });
      gsap.to(this._count, {
        value: pct, duration: .75, ease: 'power2.out',
        onUpdate: () => { e.percent.textContent = Math.round(this._count.value) + '%'; }
      });
    } else {
      e.bar.setAttribute('width', String(nextWidth));
      this._count.value = pct;
      e.percent.textContent = Math.round(pct) + '%';
    }
    this._lastPercent = pct;
    this._setActivityLabel();
  }

  _setActivityLabel() {
    const txt = { idle: 'EN REPOSO', reading: 'LEYENDO', writing: 'ESCRIBIENDO' };
    this._els.activity.textContent = txt[this._activityMode] || txt.idle;
    this._els.led.setAttribute('opacity', this._activityMode === 'idle' ? '.43' : '1');
  }

  _stopAnimations() {
    const gsap = globalThis.gsap;
    if (!gsap) return;
    gsap.killTweensOf([this._els.platter, this._els.head, this._els.led]);
    gsap.killTweensOf(this._count);
    gsap.killTweensOf(this._els.bar);
  }

  _applyActivity() {
    const mode = (this.getAttribute('activity') || 'idle').toLowerCase();
    this._activityMode = ['reading','writing'].includes(mode) ? mode : 'idle';
    this._setActivityLabel();
    const gsap = globalThis.gsap;
    if (!gsap) return; // Data and SVG remain usable even before GSAP loads.
    const { platter, head, led } = this._els;
    gsap.killTweensOf([platter, head, led]);
    gsap.set(head, { transformOrigin: '35% 61%' });
    gsap.set(platter, { transformOrigin: '50% 50%' });

    if (this._paused || this._reduceMotion?.matches || this._activityMode === 'idle') {
      gsap.to(head, { rotation: 0, duration: .45, ease: 'power2.out' });
      gsap.to(led, { opacity: .43, duration: .3 });
      return;
    }
    const speed = this._activityMode === 'writing' ? .72 : 1.15;
    // Resume from the last position without a visible jump.
    const current = Number(gsap.getProperty(platter, 'rotation')) || 0;
    gsap.fromTo(platter, { rotation: current }, {
      rotation: current + 360, duration: speed, ease: 'none', repeat: -1
    });
    gsap.fromTo(head, { rotation: -3.3 }, {
      rotation: 4.5, duration: this._activityMode === 'writing' ? .27 : .58,
      repeat: -1, yoyo: true, ease: 'sine.inOut'
    });
    gsap.to(led, { opacity: .3, duration: .26, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  }
}

if (!customElements.get('game-access-hdd')) {
  customElements.define('game-access-hdd', GameAccessHdd);
}
export { GameAccessHdd };
