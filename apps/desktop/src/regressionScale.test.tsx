import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LibraryRoom from "./LibraryRoom";
import type { CatalogGame } from "./types";

import app from "./App.tsx?raw";
import room from "./LibraryRoom.tsx?raw";

const games: CatalogGame[] = Array.from({ length: 60 }, (_, index) => ({
  id: index + 1,
  slug: `game-${index + 1}`,
  name: `Game ${index + 1}`,
  app_id: 10_000 + index,
  credit_cost_per_hour: 0,
  copies_total: 1,
  copies_available: 1,
}));

describe("desktop regression scale guard", () => {
  it("previews a large catalog with an expansion control and the full count", () => {
    const markup = renderToStaticMarkup(
      <LibraryRoom games={games} downloads={{}} busy={false} onPlay={() => undefined} onDownload={() => undefined} />,
    );
    expect((markup.match(/library-room-card(?:\s|\")/g) ?? []).length).toBe(8);
    expect(markup).toContain("60 juegos");
    expect(markup).toContain("Ver todos");
  });

  it("does not restore the old startup detail preload or 24-game installation cutoff", () => {
    expect(app).not.toContain("slice(0, 24)");
    expect(app).not.toContain("slice(0,24)");
    expect(app).not.toContain("games.slice(0, 8)");
    expect(room).not.toContain("games.slice(0, 8)");
  });
});
