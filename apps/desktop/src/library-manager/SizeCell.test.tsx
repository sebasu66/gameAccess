import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LibraryGame } from "../catalog/DigitalProcessManager";
import { copy } from "./copy";
import { formatBytes } from "./format";
import { SizeCell } from "./SizeCell";

const GB = 1e9;
const base: LibraryGame = { app_id: 284160, name: "BeamNG.drive", state: "ready", folder: "C:\\juegos\\284160-BeamNG.drive-ready", installed: true, needs_repair: false,
  error: "", warning: "", issues: [], standard: true, reclaimable_bytes: 0, transfer_bytes: null, transfer_active: false, size_bytes: 53.7 * GB };

describe("the size column of the Library Manager", () => {
  it("shows a compressed game's size on disk, its real size and what it saves", () => {
    const game = { ...base, frozen: "freeze" as const, frozen_bytes: 22.5 * GB, original_bytes: 53.7 * GB };
    const html = renderToStaticMarkup(<SizeCell game={game} largest={60 * GB} c={copy.es} />);
    expect(html).toContain(formatBytes(22.5 * GB));
    expect(html).toContain(formatBytes(53.7 * GB));
    expect(html).toContain(copy.es.saved(formatBytes(31.2 * GB), 58));
    expect(html).toContain('data-frozen="freeze"');
  });

  it("shows only the size of a game that is not compressed", () => {
    const html = renderToStaticMarkup(<SizeCell game={base} largest={60 * GB} c={copy.es} />);
    expect(html).toContain(formatBytes(53.7 * GB));
    expect(html).not.toContain("data-frozen");
  });
});
