// The guide over Ollama's own pages, in the "Connect AI" window (ai_connection.rs). It points at what to press on the
// sign-in, sign-up and key pages; it never types the player's email or password. When Ollama shows the new key, it
// hands it to Game Access through a gameaccess-ai:// navigation that the window stops before it leaves the PC.
// The window runs this before the page is parsed and in every frame: only the top page gets the guide, once it has a
// root element. Google opens in the player's browser (ai_connection.rs), so its button stays.
(() => {
  if (window.__gaGuide || window.top !== window) return; window.__gaGuide = true;
  const css = `
  #ga-guide-ring{position:fixed;z-index:2147483646;border-radius:10px;pointer-events:none;transition:all .25s ease;
    box-shadow:0 0 0 3px #cc8333,0 0 0 9999px #05080cb3,0 0 24px 6px #cc833388}
  #ga-guide-tip{position:fixed;z-index:2147483647;width:340px;max-width:calc(100vw - 32px);font:14px/1.5 Manrope,"Segoe UI",sans-serif;color:#f4f4f2;
    background:linear-gradient(135deg,#2b1d14f5,#16191df5 50%);border:1px solid #ffffff30;border-radius:12px;padding:16px 18px;box-shadow:0 24px 60px #000a;transition:top .25s,left .25s}
  #ga-guide-tip .e{font:800 11px Manrope,"Segoe UI",sans-serif;letter-spacing:.18em;color:#cc8333;text-transform:uppercase}
  #ga-guide-tip .t{font:700 17px Manrope,"Segoe UI",sans-serif;margin:4px 0}
  #ga-guide-tip .h{color:#c8ced2;margin:0}
  #ga-guide-tip .ok{color:#a0d2b4}
  #ga-guide-tip .bar{display:flex;gap:4px;margin-top:12px}#ga-guide-tip .bar i{flex:1;height:3px;border-radius:2px;background:#ffffff22}#ga-guide-tip .bar i.on{background:#cc8333}`;
  const style = document.createElement('style'); style.textContent = css;
  const ring = document.createElement('div'); ring.id = 'ga-guide-ring';
  const tip = document.createElement('div'); tip.id = 'ga-guide-tip'; tip.setAttribute('role', 'status');
  // An open <dialog> sits in the browser's top layer, above any z-index: the guide moves inside it while it is open.
  const mount = () => { const host = document.querySelector('dialog[open]') || document.body; if (ring.parentNode !== host) host.append(ring, tip); };

  const q = s => document.querySelector(s);
  const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(el => visible(el) && re.test(el.textContent.trim()));
  const keyDialog = () => [...document.querySelectorAll('dialog[open]')].find(d => d.querySelector('[name="api-key-name"]'));
  const codeInput = 'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]';
  let taken = false;
  const hand = key => { taken = true; location.href = 'gameaccess-ai://key?k=' + encodeURIComponent(key); };

  // Each step: when it applies, what to point at and what to say. The first that applies wins.
  const steps = [
    // Once the key is taken the guide is done: closing Ollama's dialog must not ask for a key again.
    { n: 4, when: () => taken || keyDialog()?.querySelector('code'), at: () => keyDialog()?.querySelector('code'),
      run: el => { if (!taken) hand(el.textContent.trim()); },
      title: '¡Listo!', text: '<span class="ok">Game Access ya tiene tu clave.</span> Esta ventana se cierra sola.' },
    { n: 3, when: () => keyDialog(), at: () => keyDialog().querySelector('[name="api-key-name"]').value.trim()
        ? keyDialog().querySelector('button[type="submit"]') : keyDialog().querySelector('[name="api-key-name"]'),
      run: () => { const field = keyDialog().querySelector('[name="api-key-name"]'); if (!field.value && !field.dataset.ga) { field.dataset.ga = '1'; field.value = 'GameAccess'; field.dispatchEvent(new Event('input', { bubbles: true })); } },
      title: 'Tocá Create', text: 'Ya le pusimos de nombre <b>GameAccess</b>. Tocá <b>Create</b> y Game Access toma la clave solo.' },
    { n: 3, when: () => location.host === 'ollama.com', at: () => byText('button', /^Create API key$/),
      title: 'Creá tu clave', text: 'Tocá <b>Create API key</b>. Es gratis y la podés borrar cuando quieras.' },
    { n: 2, when: () => q(codeInput), at: () => q(codeInput),
      title: 'Revisá tu correo', text: 'Ollama te mandó un código. Escribilo acá.' },
    { n: 2, when: () => q('input[type="password"]'), at: () => q('input[type="password"]'),
      title: 'Tu contraseña', text: 'Escribila acá y tocá <b>Continuar</b>. La contraseña queda en Ollama: Game Access no la ve.' },
    { n: 1, when: () => q('input[name="email"]') && location.pathname.includes('sign-up'), at: () => q('input[name="email"]'),
      title: 'Creá tu cuenta', text: 'Escribí tu correo y tocá <b>Continuar</b>, o usá <b>GitHub</b>. <b>Google</b> se abre en tu navegador.' },
    { n: 1, when: () => q('input[name="email"]'), at: () => q('input[name="email"]'),
      title: 'Entrá a Ollama', text: () => 'Escribí tu correo y tocá <b>Continuar</b>, o usá <b>GitHub</b>. <b>Google</b> se abre en tu navegador.'
        + (byText('a', /^(Registrarse|Sign up)$/) ? ' ¿No tenés cuenta? Tocá <b>Registrarse</b>, abajo.' : '') },
  ];

  let last = '';
  function tick() {
    if (!document.body) return; mount();
    const step = steps.find(s => { try { return s.when(); } catch { return false; } });
    let el = null; try { el = step && step.at(); } catch { el = null; }
    if (!step || !visible(el)) { ring.style.display = tip.style.display = 'none'; return; }
    if (step.run) step.run(el);
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(ring.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const text = typeof step.text === 'function' ? step.text() : step.text;
    const html = `<div class="e">Game Access · paso ${step.n} de 4</div><div class="t">${step.title}</div><p class="h">${text}</p>
      <div class="bar">${[1, 2, 3, 4].map(i => `<i class="${i <= step.n ? 'on' : ''}"></i>`).join('')}</div>`;
    if (html !== last) { tip.innerHTML = html; last = html; }
    tip.style.display = 'block';
    const below = r.bottom + 14 + tip.offsetHeight < innerHeight;
    tip.style.top = (below ? r.bottom + 14 : Math.max(16, r.top - 14 - tip.offsetHeight)) + 'px';
    tip.style.left = Math.min(Math.max(16, r.left), innerWidth - tip.offsetWidth - 16) + 'px';
  }
  // The guide's own changes (its position, its text) must not wake it again.
  const ours = node => node === ring || node === tip || tip.contains(node);
  const start = () => {
    document.documentElement.appendChild(style);
    new MutationObserver(list => { if (list.some(m => !ours(m.target))) tick(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    addEventListener('resize', tick); addEventListener('scroll', tick, true); setInterval(tick, 500); tick();
  };
  if (document.documentElement) start();
  else new MutationObserver((_, watch) => { if (document.documentElement) { watch.disconnect(); start(); } }).observe(document, { childList: true });
})();
