import { useMemo, useState } from "react";

import type { CatalogGame } from "./types";

const STORAGE_KEY = "gameaccess:hidden-games";

function loadHiddenIds(): number[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

export function useHiddenLibraryGames(games: CatalogGame[]) {
  const [hiddenIds, setHiddenIds] = useState<number[]>(loadHiddenIds);
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const visibleGames = useMemo(() => games.filter((game) => !hidden.has(game.id)), [games, hidden]);

  const hideGame = (game: CatalogGame) => {
    setHiddenIds((current) => {
      if (current.includes(game.id)) return current;
      const next = [...current, game.id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const restoreHidden = () => {
    localStorage.removeItem(STORAGE_KEY);
    setHiddenIds([]);
  };

  return { visibleGames, hiddenCount: hiddenIds.length, hideGame, restoreHidden };
}
