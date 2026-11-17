import type { CatalogGame } from "./types";
import type { CoverTier } from "./coverSize";

/**
 * Fallback chains for game artwork, so no grid shows a broken or empty picture.
 *
 * Each picture walks a list of candidate URLs: the one that worked last time first, then what the catalog gives,
 * then the paths Steam serves without a hash. A URL that fails (error, 0x0 or Steam's tiny placeholder) is
 * remembered as broken for a few days and skipped, the one that loads is remembered as the game's picture, and
 * when every candidate fails the card shows its title over a background instead of a hole. The memory lives in
 * two small capped maps in localStorage (never one key per game: the catalog has 46 thousand of them).
 */
export type ArtKind = "portrait" | "wide";

const STORE = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
const OLD_CDN = "https://cdn.akamai.steamstatic.com/steam/apps";
const WORKED_KEY = "gameaccess:art-worked";
const BROKEN_KEY = "gameaccess:art-broken";
const MAX_ENTRIES = 1500;
const WORKED_DAYS = 14;
// A broken URL is retried after a while: Steam publishes new art, and a failure can be a dropped connection.
const BROKEN_DAYS = 3;
const DAY = 86400000;
/** Below this size an image is Steam's placeholder (or a 1x1 pixel), not a cover. */
export const MIN_ARTWORK_SIZE = 32;

type Entry = { url?: string; at: number };
let worked: Map<string, Entry> | null = null;
let broken: Map<string, Entry> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(key: string): Map<string, Entry> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object") return new Map(Object.entries(value as Record<string, Entry>).filter(([, entry]) => entry && typeof entry.at === "number"));
  } catch { /* an unreadable memory starts empty */ }
  return new Map();
}

const workedMap = () => (worked ??= load(WORKED_KEY));
const brokenMap = () => (broken ??= load(BROKEN_KEY));

function trimmed(map: Map<string, Entry>): Record<string, Entry> {
  const entries = [...map.entries()];
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_ENTRIES)));
}

// Writes are batched: a grid that loads forty covers writes the memory once.
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (worked) localStorage.setItem(WORKED_KEY, JSON.stringify(trimmed(worked)));
      if (broken) localStorage.setItem(BROKEN_KEY, JSON.stringify(trimmed(broken)));
    } catch { /* the memory still works for this session */ }
  }, 1000);
}

/** Re-inserting moves an entry to the end, so trimming drops the oldest ones. */
function put(map: Map<string, Entry>, key: string, entry: Entry): void {
  map.delete(key);
  map.set(key, entry);
  scheduleSave();
}

const slot = (appId: number, kind: ArtKind) => `${kind}:${appId}`;

export function rememberedArtwork(appId: number | null | undefined, kind: ArtKind, now = Date.now()): string | null {
  if (!appId) return null;
  const entry = workedMap().get(slot(appId, kind));
  return entry?.url && now - entry.at < WORKED_DAYS * DAY && !isArtworkBroken(entry.url, now) ? entry.url : null;
}

export function rememberArtwork(appId: number | null | undefined, kind: ArtKind, url: string): void {
  if (!appId || !url) return;
  brokenMap().delete(url);
  if (workedMap().get(slot(appId, kind))?.url === url) return;
  put(workedMap(), slot(appId, kind), { url, at: Date.now() });
}

export function isArtworkBroken(url: string, now = Date.now()): boolean {
  const entry = brokenMap().get(url);
  return Boolean(entry && now - entry.at < BROKEN_DAYS * DAY);
}

export function markArtworkBroken(url: string, appId?: number | null, kind?: ArtKind): void {
  if (!url) return;
  put(brokenMap(), url, { at: Date.now() });
  if (appId && kind && workedMap().get(slot(appId, kind))?.url === url) {
    workedMap().delete(slot(appId, kind));
    scheduleSave();
  }
}

/** Clears the memory (tests, and a future "reload artwork" action). */
export function resetArtworkMemory(): void {
  worked = new Map();
  broken = new Map();
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { localStorage.removeItem(WORKED_KEY); localStorage.removeItem(BROKEN_KEY); } catch { /* nothing stored */ }
}

/** A loaded image is usable when it has real pixels: a 0x0 decode or Steam's tiny placeholder counts as broken. */
export function isUsableArtwork(width: number, height: number): boolean {
  return width >= MIN_ARTWORK_SIZE && height >= MIN_ARTWORK_SIZE;
}

const clean = (urls: Array<string | null | undefined>) =>
  [...new Set(urls.filter((url): url is string => typeof url === "string" && Boolean(url.trim())).map(url => url.trim()))];

/**
 * Portrait candidates after the resolver's hashed path: the catalog's library capsule, then the unhashed library
 * capsule in both sizes (the requested size first). Recent games only publish hashed paths, so these answer 404
 * for them, but they cost one request each and only for cards whose resolver found nothing.
 */
export function portraitCandidates(game: Pick<CatalogGame, "app_id" | "capsule_image">, tier: CoverTier = "2x"): string[] {
  const id = game.app_id;
  const capsule = game.capsule_image && /library_(capsule|600x900)/.test(game.capsule_image) ? game.capsule_image : null;
  const small = id ? `${STORE}/${id}/library_600x900.jpg` : null;
  const large = id ? `${STORE}/${id}/library_600x900_2x.jpg` : null;
  return clean([capsule, ...(tier === "1x" ? [small, large] : [large, small]), id ? `${OLD_CDN}/${id}/library_600x900.jpg` : null]);
}

/** Wide (header) candidates: the catalog's header, Steam's header in both hosts, the 616x353 capsule, the hero. */
export function wideCandidates(game: Partial<Pick<CatalogGame, "app_id" | "header_image" | "capsule_image" | "hero_image">>): string[] {
  const id = game.app_id;
  const capsule = game.capsule_image && !/library_(capsule|600x900)/.test(game.capsule_image) ? game.capsule_image : null;
  return clean([
    game.header_image,
    id ? `${STORE}/${id}/header.jpg` : null,
    id ? `${OLD_CDN}/${id}/header.jpg` : null,
    id ? `${STORE}/${id}/capsule_616x353.jpg` : null,
    game.hero_image,
    capsule,
  ]);
}

/** The chain to walk: what worked last time first, then the candidates, without the URLs known to be broken. */
export function artworkChain(appId: number | null | undefined, kind: ArtKind, candidates: Array<string | null | undefined>, now = Date.now()): string[] {
  return clean([rememberedArtwork(appId, kind, now), ...candidates]).filter(url => !isArtworkBroken(url, now));
}

/** Two letters for a card too small for its title (the library manager's thumbnails). */
export function artworkMonogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}
