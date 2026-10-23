import { describe, expect, it } from "vitest";
import { DigitalCatalog, GameAlreadyInstalledError } from "./DigitalCatalog";
import { translate } from "../i18n";
import type { CatalogGame } from "../types";

const game = { id: 620, app_id: 620, name: "Portal 2" } as CatalogGame;

describe("one install per game", () => {
  it("refuses to download a game that is already installed and says to uninstall it first", async () => {
    const catalog = new DigitalCatalog({ isInstalledHandler: async () => true });
    const failure = await catalog.download(game, { url: "magnet:?xt=urn:btih:abc", title: "Portal 2 v2", type: "torrent", size: "", score: 0, pluginName: "P", sourceName: "S" }).catch(error => error);
    expect(failure).toBeInstanceOf(GameAlreadyInstalledError);
    expect(failure.message).toBe(translate("downloadAlreadyInstalled", { name: "Portal 2" }));
  });
});
