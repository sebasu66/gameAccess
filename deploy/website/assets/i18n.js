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
    soon: 'Próximamente', navFaq: 'Preguntas',
    f1Title: 'Un catálogo enorme', f1Text: 'Más de 40.000 juegos de PC con búsqueda por título, género, etiquetas y modo de juego. Lo nuevo y lo más jugado, siempre al día.',
    f2Title: 'Fichas completas', f2Text: 'Tráiler, capturas, descripción y valoraciones de cada juego, para decidir antes de jugar.',
    f3Title: 'Tus juegos de Steam, de todas tus cuentas', f3Text: 'Game Access trae los juegos de cada cuenta que Steam recuerda en tu PC y, al jugar, cambia a la cuenta dueña sola. Nunca te pide contraseñas.',
    f4Title: 'Importá lo que ya tenés', f4Text: 'Revisa tus discos, reconoce los juegos que encuentra y los suma a tu biblioteca, sin moverlos si no querés.',
    f5Title: 'Biblioteca ordenada', f5Text: 'Una sola carpeta de juegos, nombres prolijos y avisos claros cuando algo falla. Mové, arreglá o quitá juegos con un clic.',
    f6Title: 'Pantalla grande y mando', f6Text: 'Un modo pensado para la tele: navegá todo con el joystick desde el sillón.',
    howTitle: 'Cómo funciona',
    s1Title: 'Instalá Game Access', s1Text: 'Bajá el instalador para Windows. Si usás Steam, instalalo antes.',
    s2Title: 'Juntá tu biblioteca', s2Text: 'Tus juegos de Steam aparecen solos; los de tus discos los sumás con el importador.',
    s3Title: 'Jugá', s3Text: 'Un botón, el juego arranca. Game Access se actualiza solo, sin que tengas que hacer nada.',
    dlTitle: 'Descargá la beta', dlText: 'Gratis para Windows 10 y 11 de 64 bits.', dlButton: 'Descargar para Windows',
    dlNote: 'Estamos en beta: algunas funciones todavía están en desarrollo.', dlVersion: 'Versión {v} · {size} MB',
    faqTitle: 'Preguntas frecuentes',
    q1: '¿Cuánto cuesta?', a1: 'Nada. La beta es gratuita.',
    q2: 'Windows dice «Windows protegió tu PC». ¿Es seguro?', a2: 'Es el aviso que Windows muestra con los programas nuevos que todavía tienen pocas descargas. Tocá «Más información» y después «Ejecutar de todas formas».',
    q3: '¿Necesito Steam?', a3: 'Para instalar Game Access, sí: instalá Steam primero. Game Access usa las sesiones que Steam ya recuerda y nunca lee ni guarda tus contraseñas.',
    q4: '¿Cómo se actualiza?', a4: 'Solo. Cada vez que lo abrís busca una versión nueva y, si hay, la instala y se reinicia. Tus juegos y tus ajustes se conservan.',
    q5: '¿Dónde guarda mis datos?', a5: 'En tu PC, en la carpeta %LOCALAPPDATA%\\gameAccess. Los juegos van a la carpeta de juegos que elijas (por defecto C:\\GA_Juegos).',
    q6: 'Encontré un error. ¿Qué hago?', a6: 'Contanos qué hiciste y qué pasó por el mismo grupo donde te llegó la invitación. Si podés, sumá una captura.',
    footer: 'Jugá más y mejor.',
    plusPageTitle: 'Game Access PLUS', plusPageDescription: 'Game Access PLUS: próximamente.',
    plusEyebrow: 'Game Access PLUS', plusTitle: 'Próximamente', plusText: 'Estamos preparando funciones extra para quienes quieran apoyar el proyecto. Mientras tanto, Game Access es gratis y completo.', plusBack: 'Volver al inicio',
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
    soon: 'Coming soon', navFaq: 'FAQ',
    f1Title: 'A huge catalog', f1Text: 'Over 40,000 PC games with search by title, genre, tags and game mode. New releases and the most played, always up to date.',
    f2Title: 'Complete game pages', f2Text: 'Trailer, screenshots, description and reviews for every game, so you can decide before you play.',
    f3Title: 'Your Steam games, from all your accounts', f3Text: 'Game Access brings in the games of every account Steam remembers on your PC and switches to the owner account when you play. It never asks for passwords.',
    f4Title: 'Import what you already have', f4Text: 'It scans your drives, recognizes the games it finds and adds them to your library, without moving them unless you want to.',
    f5Title: 'A tidy library', f5Text: 'One games folder, clean names and clear notices when something fails. Move, fix or remove games with one click.',
    f6Title: 'Big screen and controller', f6Text: 'A mode made for the TV: browse everything with your gamepad from the couch.',
    howTitle: 'How it works',
    s1Title: 'Install Game Access', s1Text: 'Get the Windows installer. If you use Steam, install it first.',
    s2Title: 'Gather your library', s2Text: 'Your Steam games show up on their own; add the ones on your drives with the importer.',
    s3Title: 'Play', s3Text: 'One button and the game starts. Game Access updates itself, with nothing for you to do.',
    dlTitle: 'Get the beta', dlText: 'Free for 64-bit Windows 10 and 11.', dlButton: 'Download for Windows',
    dlNote: 'We are in beta: some features are still in development.', dlVersion: 'Version {v} · {size} MB',
    faqTitle: 'Frequently asked questions',
    q1: 'How much does it cost?', a1: 'Nothing. The beta is free.',
    q2: 'Windows says “Windows protected your PC”. Is it safe?', a2: 'It is the notice Windows shows for new programs that still have few downloads. Click “More info” and then “Run anyway”.',
    q3: 'Do I need Steam?', a3: 'To install Game Access, yes: install Steam first. Game Access uses the sign-ins Steam already remembers and never reads or stores your passwords.',
    q4: 'How does it update?', a4: 'On its own. Every time you open it, it looks for a new version and, if there is one, installs it and restarts. Your games and settings are kept.',
    q5: 'Where does it keep my data?', a5: 'On your PC, in %LOCALAPPDATA%\\gameAccess. Games go to the games folder you choose (C:\\GA_Juegos by default).',
    q6: 'I found a bug. What do I do?', a6: 'Tell us what you did and what happened in the same group where you got the invitation. A screenshot helps.',
    footer: 'Play more, play better.',
    plusPageTitle: 'Game Access PLUS', plusPageDescription: 'Game Access PLUS: coming soon.',
    plusEyebrow: 'Game Access PLUS', plusTitle: 'Coming soon', plusText: 'We are preparing extra features for those who want to support the project. Meanwhile, Game Access is free and complete.', plusBack: 'Back to home',
  },
};
const KEY = 'ga-site-lang';
function stored() { try { return localStorage.getItem(KEY); } catch { return null; } }
function remember(lang) { try { localStorage.setItem(KEY, lang); } catch { /* private mode: not remembered */ } }
function apply(lang) {
  const t = TEXT[lang] || TEXT.es;
  document.documentElement.lang = lang;
  // A page other than the home names its own title and description keys: <html data-page="plus"> uses plusPageTitle.
  const page = document.documentElement.dataset.page || '';
  document.title = t[page ? `${page}PageTitle` : 'title'] || t.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', t[page ? `${page}PageDescription` : 'description'] || t.description);
  document.querySelectorAll('[data-i18n]').forEach(el => {
    let v = t[el.dataset.i18n];
    if (v === undefined) return;
    // data-i18n-vars='{"v":"0.1.2"}' fills {v} in the text
    if (el.dataset.i18nVars) { try { const vars = JSON.parse(el.dataset.i18nVars); v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)); } catch { /* text as is */ } }
    el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    for (const pair of el.dataset.i18nAttr.split(';')) { const [attr, key] = pair.split(':'); if (t[key] !== undefined) el.setAttribute(attr, t[key]); }
  });
  document.querySelectorAll('.lang-switch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}
let current = stored() || ((navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en');
apply(current);
document.querySelectorAll('.lang-switch button').forEach(b => b.addEventListener('click', () => { current = b.dataset.lang; remember(current); apply(current); }));
// Text that arrives later (the release's version) asks for the page to be translated again.
document.addEventListener('ga-i18n-refresh', () => apply(current));
})();
