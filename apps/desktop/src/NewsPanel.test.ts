import { describe, expect, it } from "vitest";
import { NEWS_COVERS_MAX, splitNewsGames } from "./NewsPanel";
import type { CatalogGame } from "./types";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const game = (id: number, release_date?: string | null) => ({ id, app_id: id, name: `G${id}`, release_date }) as CatalogGame;

describe("splitNewsGames", () => {
  it("shows covers only for games released in the last six months, newest first", () => {
    const games = [game(1, "2020-01-01"), game(2, "2026-09-01"), game(3, "2026-11-01"), game(4, null), game(5, "2027-01-01"), game(6, "Oct 2, 2026")];
    const { covers, links } = splitNewsGames(games, NOW);
    expect(covers.map(g => g.id)).toEqual([3, 6, 2]);
    expect(links.map(g => g.id)).toEqual([1, 4, 5]);
  });

  it("caps the covers and lists the remaining new games as links", () => {
    const games = Array.from({ length: NEWS_COVERS_MAX + 5 }, (_, i) => game(i + 1, `2026-10-${String((i % 28) + 1).padStart(2, "0")}`));
    const { covers, links } = splitNewsGames(games, NOW);
    expect(covers).toHaveLength(NEWS_COVERS_MAX);
    expect(links).toHaveLength(5);
    expect(new Set([...covers, ...links]).size).toBe(games.length);
  });
});
