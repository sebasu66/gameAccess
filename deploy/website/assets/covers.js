// Animated cover grid behind the opening section, like the app's opening backdrop (GameCoverBackdrop.tsx), with
// Steam's vertical artwork. No game is ever on screen twice: the grid starts with distinct games in a random order,
// and each cover that changes takes a game that is not showing anywhere else.
(() => {
// The 120 most reviewed catalog games (deploy/catalog-cache) with a review score of 75 or more, no adult content,
// and a vertical cover on Steam (checked 2026-10-21).
const games = [730, 570, 271590, 359550, 1245620, 1172470, 381210, 1174180, 346110, 945360, 218620, 230410, 1085660,
  105600, 252950, 304930, 4000, 582010, 1097150, 221100, 2767030, 413150, 377160, 291550, 1281930, 251570, 739630,
  1172620, 275850, 289070, 444090, 648800, 394360, 990080, 49520, 107410, 2073850, 1966720, 255710, 892970, 261550,
  438100, 550, 960090, 1551360, 311210, 700330, 284160, 393380, 3164500, 1808500, 534380, 1238840, 2139460, 264710,
  367520, 281990, 1625450, 1623730, 1118200, 12210, 620, 552520, 548430, 22380, 1222670, 250900, 211820, 108600,
  391540, 1782210, 1229490, 244210, 262060, 444200, 227300, 552990, 2881650, 671860, 1145360, 3241660, 208650, 526870,
  714010, 236850, 552500, 698780, 1794680, 1677740, 581320, 232090, 1151640, 222880, 674940, 225540, 412020, 294100,
  1973530, 386360, 1604030, 427520, 1818750, 220240, 305620, 677620, 231430, 374320, 356190, 976310, 2379780, 1259420,
  287700, 219990, 239140, 1217060, 1721470, 241930, 1237970, 2923300, 270880];
const art = id => `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
const grid = document.querySelector('.cover-grid');
if (!grid) return;
const SLOTS = 48;
const shuffled = games.slice();
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const showing = new Set();                 // games on screen, including one that is fading in
const waiting = shuffled.slice(SLOTS);     // games not on screen
const slots = [];
for (let i = 0; i < SLOTS; i++) {
  const cell = document.createElement('div'); cell.className = 'cover';
  const front = new Image(), back = new Image();
  for (const img of [front, back]) { img.alt = ''; img.decoding = 'async'; img.draggable = false; cell.append(img); }
  const id = shuffled[i];
  front.src = art(id); front.className = 'is-shown'; showing.add(id);
  grid.append(cell); slots.push({ front, back, id, busy: false });
}
if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
function swap() {
  const s = slots[Math.floor(Math.random() * slots.length)];
  if (s.busy || !waiting.length) return;
  const next = waiting.splice(Math.floor(Math.random() * waiting.length), 1)[0];
  s.busy = true; showing.add(next);
  const done = ok => {
    s.back.onload = s.back.onerror = null;
    if (ok) {
      s.back.className = 'is-shown'; s.front.className = '';
      [s.front, s.back] = [s.back, s.front];
      showing.delete(s.id); waiting.push(s.id); s.id = next;
    } else { showing.delete(next); }   // a cover that does not load is simply left out
    s.busy = false;
  };
  s.back.onload = () => done(true); s.back.onerror = () => done(false);
  s.back.src = art(next);
}
let timer = setInterval(swap, 900);
document.addEventListener('visibilitychange', () => {
  clearInterval(timer); if (document.visibilityState === 'visible') timer = setInterval(swap, 900);
});
})();
