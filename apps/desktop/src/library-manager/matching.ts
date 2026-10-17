import type { CatalogGame } from "../types";

const NOISE = new Set(["repack", "fitgirl", "dodi", "codex", "skidrow", "gog", "build", "setup", "pc", "win64", "win32", "x64", "x86", "edition", "the", "of", "and", "a", "multi", "multi10", "ofme", "steam", "rip", "portable", "goty"]);

export function tokens(name: string): string[] {
  const plain = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bv?\d+(\.\d+)+\b/g, " ").replace(/[._\-:+[\]()]/g, " ");
  return plain.split(/\s+/).filter(token => token && !NOISE.has(token) && !/^v\d+$/.test(token) && !/^\d{5,}$/.test(token));
}

const catalogId = (game: CatalogGame) => (game.app_id ?? game.id) as number;

/** Catalog games whose name resembles a folder name, best first (exact words score 1). Folder names are messy, so the user confirms. */
export function suggest(folderName: string, catalog: CatalogGame[], limit = 5): Array<{ id: number; name: string; score: number }> {
  const wanted = tokens(folderName);
  if (!wanted.length) return [];
  const wantedSet = new Set(wanted);
  const found: Array<{ id: number; name: string; score: number }> = [];
  for (const game of catalog) {
    const have = tokens(game.name);
    if (!have.length) continue;
    const common = have.filter(token => wantedSet.has(token)).length;
    if (!common) continue;
    const score = common / Math.max(have.length, wanted.length) + (have.join(" ") === wanted.join(" ") ? 1 : 0);
    if (score >= 0.5) found.push({ id: catalogId(game), name: game.name, score });
  }
  return found.sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, limit);
}
