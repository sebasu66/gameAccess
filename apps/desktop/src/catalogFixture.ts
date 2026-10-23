/**
 * Loads the catalog package that ships in the installer, for tests and reports
 * that need the real data instead of hand-made fixtures.
 *
 * Needs Node's built-in `node:sqlite` (Node 22.5+). Returns null when it is not
 * available so callers can skip instead of failing a machine that cannot read it.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { CatalogGame } from "./types";

const CATALOG_DIR = new URL("../../../deploy/catalog-cache/", import.meta.url);

export interface RealCatalog {
  revision: string;
  games: CatalogGame[];
}

export async function loadRealCatalog(): Promise<RealCatalog | null> {
  let DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    prepare(sql: string): { all(): Record<string, unknown>[] };
    close(): void;
  };
  try {
    ({ DatabaseSync } = await import("node:sqlite") as never);
  } catch {
    return null;
  }
  const manifest = JSON.parse(readFileSync(new URL("catalog-manifest.json", CATALOG_DIR), "utf8")) as { revision: string };
  const packed = readFileSync(new URL(`catalog-cache-${manifest.revision}.sqlite.gz`, CATALOG_DIR));
  const path = join(mkdtempSync(join(tmpdir(), "ga-catalog-")), "catalog.sqlite");
  writeFileSync(path, gunzipSync(packed));
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const games = db.prepare("SELECT payload FROM catalog_game").all().map(row => JSON.parse(String(row.payload)) as CatalogGame);
    return { revision: manifest.revision, games };
  } finally {
    db.close();
  }
}
