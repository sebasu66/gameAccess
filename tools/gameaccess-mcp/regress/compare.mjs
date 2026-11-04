/** The comparisons of a regression pass, apart from the app so they can be tested. */

const DAY = 86400000;

/** Steam writes "Mar 3, 2022", "3 Mar, 2022", "Q1 2024" or "Coming soon": a date, or null when it is not one. */
export function steamDate(text) {
  if (!text || !/\d{4}/.test(text) || /^Q\d/i.test(text.trim())) return null;
  const time = Date.parse(text.replace(/(\d+) (\w{3}), (\d{4})/, "$2 $1, $3"));
  return Number.isNaN(time) ? null : new Date(time);
}

/** Why a Steam result does not meet the search's own score and date bars, or null when it does. */
export function steamMiss(game, search, now = Date.now()) {
  if (search.minScore !== undefined && game.score === null) return "no Steam score (few reviews)";
  if (search.minScore !== undefined && game.score < search.minScore) return "Steam score below the bar";
  if (search.maxAgeDays !== undefined) {
    const released = steamDate(game.released);
    if (!released) return "no release date on Steam";
    if (now - released.getTime() > search.maxAgeDays * DAY) return "older on Steam";
  }
  return null;
}

/** Steam has no score or age filter: the saved results are narrowed here with the search's bars. */
export function steamMatches(games, search, now = Date.now()) {
  return games.filter(game => steamMiss(game, search, now) === null);
}

/** What both find, what only Steam finds, and what only we find with the reason Steam does not show it. */
export function compareWithSteam(ours, wanted, allSteam, search = {}, now = Date.now()) {
  const wantedIds = new Set(wanted.map(game => game.app_id));
  const ourIds = new Set(ours.map(game => game.app_id));
  const steamById = new Map(allSteam.map(game => [game.app_id, game]));
  return {
    common: ours.filter(game => wantedIds.has(game.app_id)),
    missing: wanted.filter(game => !ourIds.has(game.app_id)),
    extra: ours.filter(game => !wantedIds.has(game.app_id)).map(game => {
      const steam = steamById.get(game.app_id);
      return { ...game, why: steam ? steamMiss(steam, search, now) ?? "other" : "not in Steam's results (tag or category)", steam: steam ?? null };
    }),
  };
}

/** Games a search gained and lost since the previous pass. */
export function compareWithPrevious(previousIds, ours) {
  const before = new Set(previousIds);
  const now = new Set(ours.map(game => game.app_id));
  return { added: [...now].filter(id => !before.has(id)), removed: [...before].filter(id => !now.has(id)) };
}
