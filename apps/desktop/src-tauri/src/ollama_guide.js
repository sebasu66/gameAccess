// The guide over Ollama's own pages, in the "Connect AI" window (ai_connection.rs). It stays out of the way until the
// player is signed in, then points an arrow at creating the key. It never types anything. When Ollama shows the new
// key, it hands it to Game Access through a gameaccess-ai:// navigation that the window stops before it leaves the PC.
// The window runs this before the page is parsed and in every frame: only the top page gets the guide, once it has a
// root element. Google opens in the player's browser (ai_connection.rs), so its button stays.
(() => {
  if (window.__gaGuide || window.top !== window) return; window.__gaGuide = true;
  const css = `
  #ga-guide-ring{position:fixed;z-index:2147483646;border-radius:10px;pointer-events:none;transition:all .25s ease;
    box-shadow:0 0 0 3px #cc8333,0 0 18px 4px #cc833366}
  #ga-guide-tip{position:fixed;z-index:2147483647;width:300px;max-width:calc(100vw - 32px);font:14px/1.5 Manrope,"Segoe UI",sans-serif;color:#f4f4f2;
    background:linear-gradient(135deg,#2b1d14f5,#16191df5 50%);border:1px solid #ffffff30;border-radius:12px;padding:14px 16px;box-shadow:0 24px 60px #000a;transition:top .25s,left .25s}
  #ga-guide-tip .t{font:700 16px Manrope,"Segoe UI",sans-serif}
  #ga-guide-tip .h{color:#c8ced2;margin:2px 0 0}
  #ga-guide-tip .ok{color:#a0d2b4}
  #ga-guide-arrow{position:absolute;display:none;width:40px;height:44px;margin-left:-20px;pointer-events:none;filter:drop-shadow(0 2px 6px #0009)}
  #ga-guide-tip.is-below #ga-guide-arrow{display:block;top:-50px}
  #ga-guide-tip.is-above #ga-guide-arrow{display:block;bottom:-50px;transform:rotate(180deg)}`;
  const style = document.createElement('style'); style.textContent = css;
  const ring = document.createElement('div'); ring.id = 'ga-guide-ring';
  const tip = document.createElement('div'); tip.id = 'ga-guide-tip'; tip.setAttribute('role', 'status');
  // An open <dialog> sits in the browser's top layer, above any z-index: the guide moves inside it while it is open.
  const mount = () => { const host = document.querySelector('dialog[open]') || document.body; if (ring.parentNode !== host) host.append(ring, tip); };

  const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(el => visible(el) && re.test(el.textContent.trim()));
  const keyDialog = () => [...document.querySelectorAll('dialog[open]')].find(d => d.querySelector('[name="api-key-name"]'));
  const onOllama = () => location.host === 'ollama.com';
  let taken = false;
  const hand = key => { taken = true; location.href = 'gameaccess-ai://key?k=' + encodeURIComponent(key); };

  // Each step: when it applies, what the arrow points at (none: the note waits in a corner) and what to say.
  // The first that applies wins.
  const steps = [
    // Once the key is taken the guide is done: closing Ollama's dialog must not ask for a key again.
    { when: () => taken || keyDialog()?.querySelector('code'), at: () => keyDialog()?.querySelector('code'),
      run: el => { if (!taken) hand(el.textContent.trim()); },
      title: 'Listo', text: '<span class="ok">Game Access ya tiene tu clave.</span>' },
    { when: () => keyDialog(), at: () => keyDialog().querySelector('[name="api-key-name"]').value.trim()
        ? keyDialog().querySelector('button[type="submit"]') : keyDialog().querySelector('[name="api-key-name"]'),
      title: 'Nombre de la clave', text: 'Poné un nombre y tocá Create.' },
    { when: () => onOllama(), at: () => byText('button', /^Create API key$/), title: 'Creá tu clave' },
    { when: () => !onOllama(), title: 'Entrá o creá tu cuenta', text: 'Después seguimos. Google se abre en tu navegador.' },
  ];

  const arrow = '<svg id="ga-guide-arrow" viewBox="0 0 40 44" aria-hidden="true"><path fill="#cc8333" d="M20 0 40 22H27v22H13V22H0z"/></svg>';
  let last = '';
  function tick() {
    if (!document.body) return; mount();
    const step = steps.find(s => { try { return s.when(); } catch { return false; } });
    let el = null; try { el = step && step.at && step.at(); } catch { el = null; }
    if (!step || (step.at && !visible(el))) { ring.style.display = tip.style.display = 'none'; return; }
    if (step.run) step.run(el);
    const html = `<div class="t">${step.title}</div>${step.text ? `<p class="h">${step.text}</p>` : ''}${arrow}`;
    if (html !== last) { tip.innerHTML = html; last = html; }
    tip.style.display = 'block';
    tip.classList.remove('is-below', 'is-above');
    if (!el) {
      ring.style.display = 'none';
      tip.style.top = '16px'; tip.style.left = innerWidth - tip.offsetWidth - 16 + 'px';
      return;
    }
    const r = el.getBoundingClientRect(), pad = 6, gap = 58;
    Object.assign(ring.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const below = r.bottom + gap + tip.offsetHeight < innerHeight;
    tip.classList.add(below ? 'is-below' : 'is-above');
    const left = Math.min(Math.max(16, r.left + r.width / 2 - tip.offsetWidth / 2), innerWidth - tip.offsetWidth - 16);
    tip.style.top = (below ? r.bottom + gap : Math.max(16, r.top - gap - tip.offsetHeight)) + 'px';
    tip.style.left = left + 'px';
    tip.querySelector('#ga-guide-arrow').style.left = Math.min(Math.max(24, r.left + r.width / 2 - left), tip.offsetWidth - 24) + 'px';
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
