(() => {
  const language = document.querySelector('#language');
  let lang = 'es';
  language.addEventListener('click', () => {
    lang = lang === 'es' ? 'en' : 'es';
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-es][data-en]').forEach(el => { el.textContent = el.dataset[lang]; });
    language.textContent = lang === 'es' ? 'EN' : 'ES';
  });
  const installer = document.querySelector('#installer-link');
  fetch('https://api.github.com/repos/sebasu66/gameAccess/releases/latest').then(r => r.ok ? r.json() : Promise.reject()).then(release => {
    const asset = (release.assets || []).find(item => /-setup\.exe$/i.test(item.name));
    if (!asset) return;
    installer.href = asset.browser_download_url;
    document.querySelector('#release-note').textContent = `${String(release.tag_name || '').replace(/^gameaccess-v/, '')} · ${Math.round(asset.size / 1048576)} MB`;
  }).catch(() => {});
  if (!window.gsap || !window.ScrollTrigger) {
    document.querySelector('.gameaccess-splash').style.display = 'none';
    document.querySelector('.gate-copy').style.display = 'none';
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  const setMode = mode => document.querySelectorAll('.mode-progress img').forEach(img => {
    img.src = `assets/escena/btn-${img.dataset.mode}-${img.dataset.mode === mode ? 'on' : 'off'}.webp`;
  });
  gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
    document.documentElement.classList.add('tour-motion');
    const gate = gsap.timeline({scrollTrigger:{trigger:'.gate-stage',start:'top top',end:'+=130%',pin:'.gate-sticky',scrub:1}});
    gate.to('.gate-copy',{autoAlpha:0,y:-40,duration:.2},0)
      .to('.gs-lock-turn',{rotation:90,transformOrigin:'50% 50%',duration:.25},0)
      .to('.gs-leaf.is-left',{xPercent:-103,duration:.7,ease:'none'},.25)
      .to('.gs-leaf.is-right',{xPercent:103,duration:.7,ease:'none'},.25)
      .fromTo('.gate-behind img',{scale:.88,opacity:.35},{scale:1,opacity:1,duration:.7},.25);
    document.querySelectorAll('.chapter').forEach(section => {
      ScrollTrigger.create({trigger:section,start:'top center',end:'bottom center',onEnter:()=>setMode(section.dataset.mode),onEnterBack:()=>setMode(section.dataset.mode)});
      gsap.fromTo(section.querySelector('.chapter-copy'),{y:40,opacity:0},{y:0,opacity:1,duration:.7,scrollTrigger:{trigger:section,start:'top 75%',toggleActions:'play none none reverse'}});
      gsap.fromTo(section.querySelector('.chapter-visual'),{y:60,opacity:.4},{y:-35,opacity:1,ease:'none',scrollTrigger:{trigger:section,start:'top bottom',end:'bottom top',scrub:1}});
      // Optional real recordings can be connected by adding a muted, preloaded video with this attribute.
      const video = section.querySelector('video[data-scroll-video]');
      if (video) ScrollTrigger.create({trigger:section,start:'top bottom',end:'bottom top',onUpdate:self => {
        if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = self.progress * video.duration;
      }});
    });
    return () => document.documentElement.classList.remove('tour-motion');
  });
})();
