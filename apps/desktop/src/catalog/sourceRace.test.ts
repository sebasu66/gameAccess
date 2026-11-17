import { describe, expect, it, vi } from "vitest";
import type { PluginSource } from "./PluginSources";
import { magnetInfoHash, matchesPreference, planRace, raceCandidates } from "./sourceRace";

vi.mock("../narrationLog", () => ({ narrate: () => undefined }));

const HEX = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a";
const source = (title: string, url: string, extra: Partial<PluginSource> = {}): PluginSource =>
  ({ title, url, type: "torrent", size: "20 GB", score: 1, pluginName: "Plugin", sourceName: "FitGirl", ...extra });
const magnet = (hash: string) => `magnet:?xt=urn:btih:${hash}&dn=x`;

describe("carrera de fuentes", () => {
  it("lee el hash de un magnet en hex y en base32", () => {
    expect(magnetInfoHash(magnet(HEX.toUpperCase()))).toBe(HEX);
    expect(magnetInfoHash("magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK")).toBe(HEX);
    expect(magnetInfoHash("https://example.org/a.torrent")).toBeNull();
  });

  it("lo que pidió el jugador: palabras del título y proveedor, sin importar mayúsculas ni acentos", () => {
    const item = source("Elden Ring v1.16.2 Edición Deluxe", magnet(HEX));
    expect(matchesPreference(item, { words: ["v1.16", "edicion"] })).toBe(true);
    expect(matchesPreference(item, { words: ["v1.17"] })).toBe(false);
    expect(matchesPreference(item, { provider: "fitgirl" })).toBe(true);
    expect(matchesPreference(item, { provider: "DODI" })).toBe(false);
  });

  it("no corren las marcadas, las del navegador ni un parche solo", () => {
    const listed = [source("Juego", magnet(HEX)), source("Juego Update Only", magnet("a".repeat(40))),
      source("Juego", magnet("b".repeat(40)), { delivery: "browser" }), source("Juego", magnet("c".repeat(40)), { lesson: {} as never }),
      source("Juego v2", magnet("d".repeat(40)))];
    expect(raceCandidates(listed).map(item => item.url)).toEqual([magnet(HEX), magnet("d".repeat(40))]);
  });

  it("prepara las otras a la vez y corren las que elige el servidor", async () => {
    const first = source("A", magnet(HEX));
    const others = [source("B", "resolver-b"), source("C", "resolver-c"), source("D", "https://host/page")];
    const prepare = vi.fn(async (item: PluginSource) => ({ ...item, url: item.url === "resolver-b" ? magnet("b".repeat(40)) : item.url === "resolver-c" ? magnet("c".repeat(40)) : item.url }));
    const ask = vi.fn(async (candidates: { index: number; hash: string | null }[]) => {
      expect(candidates.map(c => c.hash)).toEqual([HEX, "b".repeat(40), "c".repeat(40)]);  // the web page does not race
      return { racers: [{ index: 2 }, { index: 0 }], decideAfter: 60 };
    });
    const race = await planRace(first, [first, ...others], prepare, ask);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(race?.racers.map(r => r.title)).toEqual(["C", "A"]);
    expect(race?.decideAfter).toBe(60);
  });

  it("sin respuesta del servidor no hay carrera", async () => {
    const first = source("A", magnet(HEX));
    const race = await planRace(first, [first, source("B", magnet("b".repeat(40)))], async item => item, async () => { throw new Error("offline"); });
    expect(race).toBeUndefined();
  });
});
