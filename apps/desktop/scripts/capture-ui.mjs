import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const steamAssets = (appId) => ({
  header_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
  capsule_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
  hero_image: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
  steam_url: `https://store.steampowered.com/app/${appId}/`,
});

const catalog = [
  { id: 1, slug: "cyberpunk-2077", name: "Cyberpunk 2077", app_id: 1091500, credit_cost_per_hour: 150, copies_total: 2, copies_available: 1, availability_state: "ready", ...steamAssets(1091500) },
  { id: 2, slug: "no-mans-sky", name: "No Man's Sky", app_id: 275850, credit_cost_per_hour: 100, copies_total: 1, copies_available: 1, availability_state: "ready", ...steamAssets(275850) },
  { id: 3, slug: "elden-ring", name: "ELDEN RING", app_id: 1245620, credit_cost_per_hour: 180, copies_total: 2, copies_available: 1, availability_state: "ready", ...steamAssets(1245620) },
  { id: 4, slug: "baldurs-gate-3", name: "Baldur's Gate 3", app_id: 1086940, credit_cost_per_hour: 170, copies_total: 1, copies_available: 0, availability_state: "owned-busy", ...steamAssets(1086940) },
  { id: 5, slug: "hogwarts-legacy", name: "Hogwarts Legacy", app_id: 990080, credit_cost_per_hour: 120, copies_total: 1, copies_available: 1, availability_state: "ready", ...steamAssets(990080) },
  { id: 6, slug: "forza-horizon-5", name: "Forza Horizon 5", app_id: 1551360, credit_cost_per_hour: 130, copies_total: 0, copies_available: 0, availability_state: "unavailable", ...steamAssets(1551360) },
  { id: 7, slug: "helldivers-2", name: "HELLDIVERS 2", app_id: 553850, credit_cost_per_hour: 160, copies_total: 2, copies_available: 2, availability_state: "ready", ...steamAssets(553850) },
];

const cyberpunkDetails = {
  ...catalog[0],
  metadata_state: "ready",
  steam: {
    app_id: 1091500,
    name: "Cyberpunk 2077",
    short_description: "Cyberpunk 2077 es un RPG de acción y aventura de mundo abierto ambientado en Night City, una megalópolis obsesionada con el poder, el glamour y las modificaciones corporales.",
    about_the_game: "Adentrate en Night City como V, un mercenario ciberpunk, y construí tu propia leyenda. Explorá una ciudad enorme, desarrollá tu personaje y elegí cómo resolver cada misión.",
    developers: ["CD PROJEKT RED"],
    publishers: ["CD PROJEKT RED"],
    genres: ["RPG", "Acción", "Mundo abierto"],
    release_date: "10 DIC 2020",
    recommendation_count: 812432,
    metacritic: { score: 86 },
    price: { final_formatted: "US$ 59.99" },
    background: "https://cdn.akamai.steamstatic.com/steam/apps/1091500/library_hero.jpg",
    hero_image: "https://cdn.akamai.steamstatic.com/steam/apps/1091500/library_hero.jpg",
    screenshots: [
      { id: 1, full: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/ss_872822c5e50dc71f345416098d29fc3ae5cd26c1.1920x1080.jpg" },
      { id: 2, full: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/ss_4bda6f67580d94832ed2d5814e15e245da75292c.1920x1080.jpg" },
      { id: 3, full: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/ss_bb1a60b8e1f3f1381a0b9d5fb378e6fcfbe77d98.1920x1080.jpg" }
    ],
    movies: [],
  },
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

await page.route("http://127.0.0.1:8000/**", async (route) => {
  const url = new URL(route.request().url());
  const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
  if (url.pathname === "/catalog") return route.fulfill({ status: 200, headers, body: JSON.stringify(catalog) });
  if (url.pathname === "/users/1") return route.fulfill({ status: 200, headers, body: JSON.stringify({ id: 1, username: "seba", credits: 1500 }) });
  if (url.pathname === "/games/1/details") return route.fulfill({ status: 200, headers, body: JSON.stringify(cyberpunkDetails) });
  return route.fulfill({ status: 404, headers, body: JSON.stringify({ detail: "visual fixture" }) });
});

await page.goto("http://127.0.0.1:1420", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".game-card");
await page.waitForTimeout(3500);

const outDir = path.resolve(process.cwd(), "../../docs/screenshots");
await mkdir(outDir, { recursive: true });
await page.screenshot({ path: path.join(outDir, "desktop-home.png"), fullPage: true });

await page.locator(".game-card").first().click();
await page.waitForSelector(".detail-panel");
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(outDir, "desktop-game-detail.png"), fullPage: false });

await browser.close();
console.log(`Screenshots written to ${outDir}`);
