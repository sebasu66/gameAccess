import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setAppLocale } from "./i18n";
import { localizeLauncherText, localizeSnapshot } from "./launcherText";
import { en } from "./locales/en";
import { es } from "./locales/es";

const LAUNCHER = join(__dirname, "../../launcher/game_download_manager");

describe("launcher texts", () => {
  afterEach(() => setAppLocale("es"));

  it("turns each key into the app's language and keeps the plain parts", () => {
    const text = '⟦dlStepOf {"n": 3}⟧⟦dlBridgeProgress {"progress": 42}⟧⟦dlSeedsCount {"n": 3}⟧ · 8.0 MB/s';
    expect(localizeLauncherText(text)).toBe("Paso 3 de 3 · El servicio de aceleración de torrents está bajando el juego: 42 % · 3 fuentes · 8.0 MB/s");
    setAppLocale("en");
    expect(localizeLauncherText("⟦dlServerFailed⟧ (⟦dlErrServerSilent⟧)")).toBe("The accelerated download failed: downloading directly (the server did not answer)");
  });

  it("leaves texts without keys as they came", () => {
    expect(localizeLauncherText("Descargando pieza 3 de 9")).toBe("Descargando pieza 3 de 9");
    expect(localizeLauncherText(null)).toBeNull();
  });

  it("translates the status, error and steps of a download row", () => {
    const row = localizeSnapshot({ gameId: 1, phase: "error", progress: 0, statusText: "⟦dlServerAsking⟧", error: '⟦dlSourceNoSeeds {"seeds": 1}⟧',
      step: { id: "server", detail: "⟦dlBridgePreparing⟧", startedAt: 1 }, steps: [{ id: "route", state: "done", result: "⟦dlRouteServerHasNot⟧", ms: 5 }] });
    expect(row.statusText).toBe(es.dlServerAsking);
    expect(row.error).toContain("(1 personas compartiéndola)");
    expect(row.step?.detail).toBe(es.dlBridgePreparing);
    expect(row.steps?.[0].result).toBe(es.dlRouteServerHasNot);
  });

  it("has every key the launcher sends, in both languages, and never names the torrent bridge's provider", () => {
    const sent = new Set<string>();
    for (const file of readdirSync(LAUNCHER).filter(name => name.endsWith(".py"))) {
      for (const match of readFileSync(join(LAUNCHER, file), "utf8").matchAll(/\bui\(\s*["'](\w+)["']/g)) sent.add(match[1]);
    }
    expect(sent.size).toBeGreaterThan(40);
    for (const key of sent) {
      expect(es, key).toHaveProperty(key);
      expect(en, key).toHaveProperty(key);
    }
    for (const value of [...Object.values(es), ...Object.values(en)]) expect(String(value).toLowerCase()).not.toContain("torbox");
  });
});
