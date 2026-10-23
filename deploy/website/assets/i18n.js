// Spanish and English texts. Every element with data-i18n="key" shows TEXT[lang][key]; data-i18n-attr="attr:key"
// sets an attribute. The first visit follows the browser's language; the choice is remembered on this device.
(() => {
const TEXT = {
  es: {
    title: 'Game Access — Jugá más y mejor',
    description: 'Game Access: tu catálogo de juegos de PC. Buscá, filtrá, descargá, instalá y jugá desde un solo lugar. Beta gratuita para Windows.',
    navHow: 'Cómo funciona', navFeatures: 'Funciones', navPlugins: 'Plugins', navDownload: 'Descargar', navSections: 'Secciones',
    eyebrow: 'Beta gratuita para Windows',
    heroA: 'Jugá más.', heroB: 'Jugá mejor.',
    lead: 'Tu catálogo de juegos de PC en un solo lugar: buscá, filtrá, descargá, instalá y jugá sin salir de Game Access.',
    download: 'Descargar gratis', learnMore: 'Ver cómo funciona',
    note: 'Estamos en beta: algunas funciones todavía están en desarrollo.',
    featuresEyebrow: 'Funciones', featuresTitle: 'Todo lo que hace Game Access',
    soon: 'Próximamente',
  },
  en: {
    title: 'Game Access — Play more, play better',
    description: 'Game Access: your PC game catalog. Search, filter, download, install and play from one place. Free beta for Windows.',
    navHow: 'How it works', navFeatures: 'Features', navPlugins: 'Plugins', navDownload: 'Download', navSections: 'Sections',
    eyebrow: 'Free beta for Windows',
    heroA: 'Play more.', heroB: 'Play better.',
    lead: 'Your PC game catalog in one place: search, filter, download, install and play without leaving Game Access.',
    download: 'Download for free', learnMore: 'See how it works',
    note: 'We are in beta: some features are still in development.',
    featuresEyebrow: 'Features', featuresTitle: 'Everything Game Access does',
    soon: 'Coming soon',
  },
};
const KEY = 'ga-site-lang';
function stored() { try { return localStorage.getItem(KEY); } catch { return null; } }
function remember(lang) { try { localStorage.setItem(KEY, lang); } catch { /* private mode: not remembered */ } }
function apply(lang) {
  const t = TEXT[lang] || TEXT.es;
  document.documentElement.lang = lang;
  document.title = t.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
  document.querySelectorAll('[data-i18n]').forEach(el => { const v = t[el.dataset.i18n]; if (v !== undefined) el.textContent = v; });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    for (const pair of el.dataset.i18nAttr.split(';')) { const [attr, key] = pair.split(':'); if (t[key] !== undefined) el.setAttribute(attr, t[key]); }
  });
  document.querySelectorAll('.lang-switch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}
const initial = stored() || ((navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en');
apply(initial);
document.querySelectorAll('.lang-switch button').forEach(b => b.addEventListener('click', () => { remember(b.dataset.lang); apply(b.dataset.lang); }));
})();
