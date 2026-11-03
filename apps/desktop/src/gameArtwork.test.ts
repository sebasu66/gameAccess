import { beforeEach, describe, expect, it } from "vitest";
import { artworkChain, artworkMonogram, isArtworkBroken, isUsableArtwork, markArtworkBroken, portraitCandidates, rememberArtwork, rememberedArtwork, resetArtworkMemory, wideCandidates } from "./gameArtwork";

const STORE = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
const DAY = 86400000;

beforeEach(() => resetArtworkMemory());

describe("candidatos de portada", () => {
  it("prueban la cápsula de biblioteca del catálogo y después las rutas sin hash, la medida pedida primero", () => {
    const game = { app_id: 42, capsule_image: `${STORE}/42/abc/library_capsule.jpg` };
    expect(portraitCandidates(game, "2x")).toEqual([
      `${STORE}/42/abc/library_capsule.jpg`, `${STORE}/42/library_600x900_2x.jpg`, `${STORE}/42/library_600x900.jpg`,
      "https://cdn.akamai.steamstatic.com/steam/apps/42/library_600x900.jpg",
    ]);
    expect(portraitCandidates(game, "1x")[1]).toBe(`${STORE}/42/library_600x900.jpg`);
  });
  it("no usan una cápsula apaisada como portada", () => {
    expect(portraitCandidates({ app_id: 42, capsule_image: `${STORE}/42/capsule_184x69.jpg` }, "2x")).not.toContain(`${STORE}/42/capsule_184x69.jpg`);
    expect(portraitCandidates({ app_id: null, capsule_image: null })).toEqual([]);
  });
  it("la imagen ancha prueba el header del catálogo, los dos hosts, la cápsula 616x353 y el hero, sin repetir", () => {
    expect(wideCandidates({ app_id: 7, header_image: `${STORE}/7/header.jpg`, hero_image: "hero.jpg" })).toEqual([
      `${STORE}/7/header.jpg`, "https://cdn.akamai.steamstatic.com/steam/apps/7/header.jpg", `${STORE}/7/capsule_616x353.jpg`, "hero.jpg",
    ]);
  });
});

describe("cadena de alternativas", () => {
  const candidates = ["a.jpg", "b.jpg", "c.jpg"];
  it("pone primero la que funcionó la última vez", () => {
    rememberArtwork(42, "portrait", "c.jpg");
    expect(artworkChain(42, "portrait", candidates)).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
    expect(rememberedArtwork(42, "wide")).toBeNull();
  });
  it("salta las rotas y las vuelve a probar a los pocos días", () => {
    markArtworkBroken("a.jpg");
    expect(artworkChain(42, "portrait", candidates)).toEqual(["b.jpg", "c.jpg"]);
    expect(isArtworkBroken("a.jpg", Date.now() + 4 * DAY)).toBe(false);
    expect(artworkChain(42, "portrait", candidates, Date.now() + 4 * DAY)).toEqual(candidates);
  });
  it("una recordada que se rompe deja de ir primero", () => {
    rememberArtwork(42, "portrait", "c.jpg");
    markArtworkBroken("c.jpg", 42, "portrait");
    expect(rememberedArtwork(42, "portrait")).toBeNull();
    expect(artworkChain(42, "portrait", candidates)).toEqual(["a.jpg", "b.jpg"]);
  });
  it("una que vuelve a cargar deja de estar rota", () => {
    markArtworkBroken("a.jpg");
    rememberArtwork(42, "portrait", "a.jpg");
    expect(artworkChain(42, "portrait", candidates)[0]).toBe("a.jpg");
  });
  it("todas rotas: la cadena queda vacía y la tarjeta muestra el título", () => {
    candidates.forEach(url => markArtworkBroken(url));
    expect(artworkChain(42, "portrait", candidates)).toEqual([]);
  });
  it("una imagen de 0x0 o el marcador diminuto de Steam no sirven", () => {
    expect(isUsableArtwork(0, 0)).toBe(false);
    expect(isUsableArtwork(1, 1)).toBe(false);
    expect(isUsableArtwork(600, 900)).toBe(true);
  });
  it("el respaldo chico muestra dos letras", () => {
    expect(artworkMonogram("Half-Life 2")).toBe("HL");
    expect(artworkMonogram("Celeste")).toBe("CE");
  });
});
