/**
 * Browser preview for interface work (`?uiDemo=1`, dev builds only). Without Tauri the catalog database and the
 * launcher are not there and the screens stay empty; in this mode the catalog query, the library scan and the
 * folder snapshot answer with sample data, so the catalog, the library and the panels can be seen and tested.
 * Never active in a release build.
 */
import type { CatalogGame } from "../types";
import type { CatalogQueryParams, CatalogQueryResult } from "../catalogCache";
import { demoGames } from "../library-manager/demoData";

export const uiDemo = () => import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("uiDemo");

const art = (id: number, kind: string) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/${kind}`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const sample: Array<[number, string, string[], number, number]> = [
  // app id, name, genres, review score, release (days ago)
  [1245620, "ELDEN RING", ["Acción", "RPG"], 93, 1300], [1091500, "Cyberpunk 2077", ["Acción", "RPG"], 86, 2100],
  [1086940, "Baldur's Gate 3", ["RPG", "Aventura"], 96, 800], [2215430, "Ghost of Tsushima", ["Acción", "Aventura"], 94, 560],
  [1174180, "Red Dead Redemption 2", ["Acción", "Aventura"], 90, 2300], [1145360, "Hades", ["Acción", "Indie"], 98, 1700],
  [870780, "Control", ["Acción", "Aventura"], 88, 2000], [632470, "Disco Elysium", ["RPG", "Indie"], 92, 1500],
  [1850570, "DEATH STRANDING", ["Aventura"], 89, 1200], [367520, "Hollow Knight", ["Aventura", "Indie"], 97, 3000],
  [275850, "No Man's Sky", ["Aventura"], 84, 3]  , [814380, "Sekiro: Shadows Die Twice", ["Acción"], 95, 2500],
  [553850, "HELLDIVERS 2", ["Acción", "Shooter"], 81, 620], [2420110, "Horizon Forbidden West", ["Acción", "Aventura"], 88, 2],
  [292030, "The Witcher 3", ["RPG", "Aventura"], 96, 3500], [782330, "DOOM Eternal", ["Acción", "Shooter"], 90, 2000],
  [1903340, "Clair Obscur: Expedition 33", ["RPG"], 95, 1], [413150, "Stardew Valley", ["Indie"], 98, 3200],
  [39210, "FINAL FANTASY XIV Online", ["RPG"], 87, 4000], [620, "Portal 2", ["Puzzle"], 98, 5000],
  [284160, "BeamNG.drive", ["Simulación"], 96, 900], [881100, "Noita", ["Indie"], 93, 1800],
];
const game = ([appId, name, genres, score, released]: (typeof sample)[number], index: number): CatalogGame => ({
  id: appId, app_id: appId, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name,
  credit_cost_per_hour: 0, copies_total: 1, copies_available: 1, availability_state: "ready",
  header_image: art(appId, "header.jpg"), capsule_image: art(appId, "library_600x900.jpg"), hero_image: art(appId, "library_hero.jpg"),
  genres, tags: genres, steam_review_score: score, steam_review_count: 50000 - index * 1500, recommendation_count: 90000 - index * 3000,
  release_date: daysAgo(released), short_description: `${name}.`, has_downloads: true, availableSourceCount: 2,
});
// `?uiDemo=1&demoCatalog=600` repeats the sample up to that many games (unique ids), to test scrolling a long catalog.
const demoCatalogSize = () => (typeof window === "undefined" ? 0 : Number(new URLSearchParams(window.location.search).get("demoCatalog")) || 0);
export const demoCatalog: CatalogGame[] = /* @__PURE__ */ Array.from({ length: Math.max(sample.length, demoCatalogSize()) }, (_, index) => {
  const base = game(sample[index % sample.length], index % sample.length);
  const copy = Math.floor(index / sample.length);
  return copy ? { ...base, id: base.id * 1000 + copy, name: `${base.name} ${copy + 1}`, slug: `${base.slug}-${copy + 1}` } : base;
});

/** Games the sample player keeps in the library without having them installed yet. */
export const demoLibraryMembers = (): CatalogGame[] => demoCatalogSize()
  ? demoCatalog.slice(0, 80)  // a long library too, like a real one (80+ games)
  : demoCatalog.filter(item => [1086940, 1174180, 870780, 632470, 1850570, 2420110, 1903340, 1245620, 553850].includes(item.app_id ?? 0));

/** Folder snapshot: the sample library's installed games are on disk. */
export function demoInstalledStatuses(): Record<string, { folder: string; installed: boolean }> {
  return Object.fromEntries(demoGames.filter(entry => entry.installed).map(entry => [String(entry.app_id), { folder: entry.folder, installed: true }]));
}

/** Game folders on disk for the sample library (what the launcher's local-games scan returns). */
export function demoLocalGames(): Array<{ id: number; name: string }> {
  return demoGames.filter(entry => entry.installed && entry.app_id).map(entry => ({ id: entry.app_id as number, name: entry.name }));
}

export function queryDemoCatalog(params: CatalogQueryParams): CatalogQueryResult {
  const query = (params.query ?? "").trim().toLowerCase();
  let items = demoCatalog.filter(item =>
    (!query || item.name.toLowerCase().includes(query) || (item.genres ?? []).some(genre => genre.toLowerCase().includes(query)))
    && (!params.app_ids?.length || params.app_ids.includes(item.app_id ?? -1))
    && (!params.game_ids?.length || params.game_ids.includes(item.id))
    && (!params.genres?.length || params.genres.some(genre => item.genres?.includes(genre))));
  const direction = params.sort_direction === "asc" ? 1 : -1;
  const key = params.sort_by;
  if (key === "name") items = [...items].sort((a, b) => a.name.localeCompare(b.name) * (direction === 1 ? 1 : -1));
  else if (key === "release-date") items = [...items].sort((a, b) => String(a.release_date).localeCompare(String(b.release_date)) * direction);
  else if (key === "steam-review-score") items = [...items].sort((a, b) => ((a.steam_review_score ?? 0) - (b.steam_review_score ?? 0)) * direction);
  else items = [...items].sort((a, b) => ((a.recommendation_count ?? 0) - (b.recommendation_count ?? 0)) * direction);
  const offset = params.offset ?? 0, limit = params.limit ?? items.length;
  return { items: limit === 0 ? [] : items.slice(offset, offset + limit), total: items.length };
}
