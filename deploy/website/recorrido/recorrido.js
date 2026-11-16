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
  if (!window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  const items = [...document.querySelectorAll('.story-item')];
  const modes = [...document.querySelectorAll('.story-modes img')];
  const video = document.querySelector('.story-video');
  let selected = 0;
  function setStep(index) {
    if (index === selected) return;
    selected = index;
    items.forEach((item,i) => item.classList.toggle('is-active',i===index));
    modes.forEach((img,i) => { img.src = `assets/escena/btn-${img.dataset.mode}-${i===index?'on':'off'}.webp`; });
    document.querySelector('.story-panel').dataset.mode = modes[index].dataset.mode;
    if (video.hasAttribute('src') && Number.isFinite(video.duration) && video.duration > 0) {
      gsap.to(video,{currentTime:index / (items.length - 1) * video.duration,duration:.8,ease:'power2.inOut',overwrite:true});
    }
    gsap.fromTo(items[index],{opacity:0,y:12},{opacity:1,y:0,duration:.35,overwrite:true});
  }
  gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
    document.documentElement.classList.add('tour-motion');
    let opened = false, ready = false, progress = 0;
    const reset = () => { if (opened) { opened=false; ready=false; opening.reverse(); setStep(0); } };
    const opening = gsap.timeline({paused:true,onComplete:() => { ready=true; setStep(Math.min(3,Math.floor(Math.max(0,progress-.04)*4))); }});
    opening.to('.gate-copy',{x:18,y:-15,scale:.85,transformOrigin:'left top',duration:.45,ease:'power2.out'},0)
      .to('.gs-lock-turn',{rotation:90,transformOrigin:'50% 50%',duration:.4,ease:'power2.inOut'},0)
      .to('.gs-leaf.is-left',{xPercent:-103,duration:1.05,ease:'power2.inOut'},.3)
      .to('.gs-leaf.is-right',{xPercent:160,duration:1.05,ease:'power2.inOut'},.3)
      .to('.gate-copy',{autoAlpha:0,duration:.3},.9)
      .fromTo('.gate-behind img',{opacity:.35},{opacity:1,duration:.8},.4)
      .to(['.story-panel','.story-modes'],{autoAlpha:1,duration:.45},1.1);
    ScrollTrigger.create({trigger:'.gate-stage',start:'top top',end:'+=450%',pin:'.gate-sticky',anticipatePin:1,onUpdate:self => {
      progress=self.progress;
      if(progress>.003 && !opened){opened=true;opening.play();}
      if(ready) setStep(Math.min(3,Math.floor(Math.max(0,progress-.04)*4)));
      if(progress<=.001 && self.direction<0) reset();
    },onLeaveBack:reset});
    const back = document.querySelector('.back-top');
    const startLinks = [...document.querySelectorAll('a[href="#recorrido"]')];
    const start = event => { event.preventDefault(); window.scrollTo({top:80,behavior:'smooth'}); };
    back.addEventListener('click',reset);
    startLinks.forEach(link => link.addEventListener('click',start));
    return () => { opening.kill(); back.removeEventListener('click',reset); startLinks.forEach(link => link.removeEventListener('click',start)); document.documentElement.classList.remove('tour-motion'); };
  });
})();

