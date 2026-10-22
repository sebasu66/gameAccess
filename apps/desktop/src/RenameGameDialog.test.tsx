import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RenameGameDialog from "./RenameGameDialog";
import { translate } from "./i18n";
import type { CatalogGame } from "./types";

describe("rename a game in the library", () => {
  it("shows the current name in a field, explains it only changes the library and saves", () => {
    const html = renderToStaticMarkup(<RenameGameDialog game={{ id: 620, app_id: 620, name: "Portal 2" } as CatalogGame} current="Portal 2 (la de Juan)" onClose={() => {}} />);
    expect(html).toContain(translate("renameTitle"));
    expect(html).toContain(translate("renameMessage", { name: "Portal 2" }));
    expect(html).toContain('value="Portal 2 (la de Juan)"');
    expect(html).toContain('class="ga-field"');
    expect(html).toContain(translate("renameSave"));
  });
});
