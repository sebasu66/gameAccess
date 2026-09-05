import { Children, createRef, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LibraryRoom from "./LibraryRoom";
import { CatalogPanel } from "./LibraryRoomParts";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

const game: CatalogGame = {
  id: 10,
  slug: "test-game",
  name: "Test Game",
  app_id: 10,
  credit_cost_per_hour: 0,
  copies_total: 1,
  copies_available: 1,
};

const installed: SteamDownloadStatus = {
  app_id: 10,
  state: "installed",
  progress: 100,
  bytes_downloaded: 1,
  bytes_total: 1,
  installed: true,
};

const downloading: SteamDownloadStatus = {
  app_id: 10,
  state: "downloading",
  progress: 50,
  bytes_downloaded: 1,
  bytes_total: 2,
  installed: false,
};

function render(downloads: Record<number, SteamDownloadStatus>, copiesAvailable = 1) {
  return renderToStaticMarkup(
    <LibraryRoom
      games={[{ ...game, copies_available: copiesAvailable }]}
      downloads={downloads}
      busy={false}
      onPlay={() => undefined}
      onDownload={() => undefined}
      onOpenDetails={() => undefined}
    />,
  );
}

describe("LibraryRoom grid presentation", () => {
  it("keeps game names accessible without rendering a title below each cover", () => {
    const markup = render({});
    expect(markup).toContain('aria-label="Seleccionado: Test Game"');
    expect(markup).not.toContain("Elegí un juego");
    expect(markup).not.toContain("<strong>Test Game</strong>");
  });

  it("shows the green installation marker whenever the game is installed", () => {
    expect(render({ 10: installed })).toContain("library-install-state ready");
    expect(render({ 10: installed }, 0)).toContain("library-install-state ready");
  });

  it("shows no installed corner marker for downloading or missing games", () => {
    expect(render({ 10: downloading })).not.toContain("library-install-state ready");
    expect(render({})).not.toContain("library-install-state ready");
  });

  it("changes the selected game only through the click handler, not mouse hover", () => {
    const selections: number[] = [];
    const panel = CatalogPanel({
      games: [game],
      downloads: {},
      accountCount: 1,
      selectedIndex: 0,
      gridRef: createRef<HTMLDivElement>(),
      onSelect: (index) => selections.push(index),
    });
    const panelChildren = Children.toArray(panel.props.children);
    const grid = panelChildren[1];
    if (!isValidElement(grid)) throw new Error("Catalog grid was not rendered");
    const cards = Children.toArray((grid.props as { children?: ReactNode }).children);
    const card = cards[0];
    if (!isValidElement(card)) throw new Error("Catalog card was not rendered");
    const props = (card as ReactElement<{ onMouseEnter?: () => void; onClick?: () => void }>).props;

    expect(props.onMouseEnter).toBeUndefined();
    props.onClick?.();
    expect(selections).toEqual([0]);
  });
});
