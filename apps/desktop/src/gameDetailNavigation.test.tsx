import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import LibraryRoom from "./LibraryRoom";
import { buildActions } from "./LibraryRoomParts";
import { EMPTY_LIBRARY_FILTERS } from "./librarySearch";
import type { CatalogGame } from "./types";

const downloaded = { id: 42, app_id: 42, name: "Downloaded game", slug: "downloaded", copies_total: 0, copies_available: 0, credit_cost_per_hour: 0 } as CatalogGame;
afterEach(() => vi.unstubAllGlobals());
describe("the shared game detail overlay", () => {
  const render = (games: CatalogGame[]) => renderToStaticMarkup(<LibraryRoom games={games} externalDetailGame={downloaded}
    searchFilters={{ ...EMPTY_LIBRARY_FILTERS, genres: ["Excluded genre"] }} downloads={{}} busy={false} onPlay={() => {}} onDownload={() => {}} />);
  it("opens the requested download even when catalog filters exclude it", () => {
    const html = render([downloaded, { ...downloaded, id: 99, app_id: 99, name: "Different game" }]);
    expect(html).toContain('class="ga-detail-dialog"');
    expect(html).toContain('aria-label="Detalles de Downloaded game"');
    expect(html).not.toContain('class="detail-panel');
    expect(html).not.toContain('aria-label="Detalles de Different game"');
  });
  it("opens historical downloads even when the catalog is unavailable", () => {
    expect(render([])).toContain('aria-label="Detalles de Downloaded game"');
  });
  it("preserves prepared-game Play without depending on catalog copies", () => {
    const actions = buildActions(downloaded, { app_id: 42, state: "prepared", installed: false, progress: 100, bytes_downloaded: null, bytes_total: null }, false);
    expect(actions).toMatchObject([{ kind: "play", disabled: false }]);
    expect(buildActions(downloaded, undefined, false)).toMatchObject([{ kind: "download", disabled: false }]);
  });
});
