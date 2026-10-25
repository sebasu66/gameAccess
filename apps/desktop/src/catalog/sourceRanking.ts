/**
 * Which download option is tried first: Online-Fix when it has the game, then the newest version of the game in any
 * provider, then the plugin's own score. Old versions are shared less and less, so a newer one is the better bet even
 * when the plugin scored them alike. Updates and patches alone are never a first choice.
 */
export interface RankableSource { title: string; sourceName: string; size: string; score: number }

const ONLINE_FIX = /online[\s-]?fix/i;
const UPDATE_ONLY = /\bupdate[\s-]*only\b|\bpatch[\s-]*only\b|\bupdate\s+v?\d/i;

/** The game version in a release title ("v1.17", "Elden Ring 1.16.2", "v1 09-Razor1911"), or null. */
export function titleVersion(title: string): number[] | null {
  const clean = title.replace(/build[\s-]*\d+/gi, " ");
  const dotted = clean.match(/\bv?(\d{1,4}(?:\.\d{1,5}){1,3})\b/i);
  if (dotted) return dotted[1].split(".").map(Number);
  const spaced = clean.match(/\bv(\d{1,3})[\s_](\d{1,3})\b/i);   // "v1 09" from scene names
  return spaced ? [Number(spaced[1]), Number(spaced[2])] : null;
}

/** Steam build number in a title ("Build-23850278"): only comparable with other build numbers. */
export function titleBuild(title: string): number | null {
  const found = title.match(/build[\s-]*(\d{5,})/i);
  return found ? Number(found[1]) : null;
}

const SIZE_UNITS: Record<string, number> = { kb: 1 / 1024 / 1024, mb: 1 / 1024, gb: 1, tb: 1024 };
export function sizeGb(size: string): number {
  const found = size.replace(",", ".").match(/([\d.]+)\s*(kb|mb|gb|tb)/i);
  return found ? Number(found[1]) * SIZE_UNITS[found[2].toLowerCase()] : 0;
}

function compareVersions(a: number[] | null, b: number[] | null): number {
  if (a && !b) return -1;
  if (!a && b) return 1;
  if (!a || !b) return 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

export function rankSources<T extends RankableSource>(sources: T[]): T[] {
  const largest = Math.max(0, ...sources.map(s => sizeGb(s.size)));
  // A patch (update only, or tiny next to the full game) is offered last: on its own it is not the game.
  const partial = (s: T) => UPDATE_ONLY.test(s.title) || (largest > 1 && sizeGb(s.size) > 0 && sizeGb(s.size) < largest * 0.1);
  return sources
    .map((source, index) => ({ source, index, version: titleVersion(source.title), build: titleBuild(source.title) }))
    .sort((a, b) =>
      Number(partial(a.source)) - Number(partial(b.source))
      || Number(!ONLINE_FIX.test(a.source.sourceName)) - Number(!ONLINE_FIX.test(b.source.sourceName))
      || compareVersions(a.version, b.version)
      || (a.build !== null && b.build !== null ? b.build - a.build : 0)
      || b.source.score - a.source.score
      || a.index - b.index)
    .map(item => item.source);
}
