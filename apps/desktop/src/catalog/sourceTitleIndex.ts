import type { CatalogGame } from "../types";

/** Same normalisation the source provider uses (examples/source-provider/matcher.js). */
export function cleanTitle(title: string, split = true): string {
  if (!title) return "";
  return title.normalize("NFKD").replace(/[̀-ͯ®™©]/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(split ? /([a-z])([A-Z])/g : /(?!)/g, "$1 $2")
    .replace(/['’]/g, "").replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

const RELEASE_PREFIXES = new Set(["fitgirl", "dodi", "repack", "repacks", "onlinefix"]);

/**
 * Picks the catalog games a provider's list of source titles can belong to.
 *
 * The provider only accepts a game when the game's name is the start of a source title, so
 * every prefix of each title is looked up in the catalog instead of scanning every game.
 * This is deliberately a superset: the provider's own check still decides the real matches.
 */
export function gamesWithPossibleSources(titles: readonly string[], games: readonly CatalogGame[]): CatalogGame[] {
  // El plugin lee las mayusculas internas de dos formas (GunMan = "gun man" o "gunman"): buscamos las dos.
  const byName = new Map<string, CatalogGame[]>();
  for (const game of games) {
    for (const split of [true, false]) {
      const key = cleanTitle(game.name, split);
      if (!key) continue;
      const list = byName.get(key);
      if (!list) byName.set(key, [game]); else if (!list.includes(game)) list.push(game);
    }
  }
  const picked = new Set<CatalogGame>();
  for (const raw of titles) {
    for (const split of [true, false]) {
      const tokens = cleanTitle(raw, split).split(" ").filter(Boolean);
      while (tokens.length && RELEASE_PREFIXES.has(tokens[0])) tokens.shift();
      let prefix = "";
      for (const token of tokens) {
        prefix = prefix ? `${prefix} ${token}` : token;
        const found = byName.get(prefix);
        if (found) for (const game of found) picked.add(game);
      }
    }
  }
  return games.filter(game => picked.has(game));
}
