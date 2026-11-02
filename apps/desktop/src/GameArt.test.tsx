// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const resolve = vi.fn(async (): Promise<string | null> => null);
vi.mock("./libraryCoverResolver", () => ({ resolveLibraryCover: () => resolve(), forgetLibraryCover: vi.fn(), cachedLibraryCover: () => null }));

import { GameWideArt } from "./GameArt";
import SteamCover from "./SteamCover";
import type { CatalogGame } from "./types";
import { rememberedArtwork, resetArtworkMemory } from "./gameArtwork";

let root: Root; let host: HTMLDivElement;
// The composed cover's backdrop is a copy: the picture that loads (and fails) is the one in front.
const image = () => host.querySelector<HTMLImageElement>("img.ga-art-composed-image") ?? host.querySelector("img");
const fire = async (type: "error" | "load", size = { width: 460, height: 215 }) => {
  const img = image()!;
  Object.defineProperty(img, "naturalWidth", { value: size.width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: size.height, configurable: true });
  await act(async () => { img.dispatchEvent(new Event(type)); });
};

beforeEach(() => {
  resetArtworkMemory(); resolve.mockReset(); resolve.mockResolvedValue(null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("una imagen ancha se arregla sola", () => {
  it("pasa a la siguiente alternativa cuando una falla y recuerda la que cargó", async () => {
    act(() => root.render(<GameWideArt game={{ app_id: 42, name: "Celeste", header_image: "https://x/broken.jpg" }} />));
    expect(image()!.getAttribute("src")).toBe("https://x/broken.jpg");
    await fire("error");
    expect(image()!.getAttribute("src")).toContain("/42/header.jpg");
    await fire("load");
    expect(image()!.style.visibility).toBe("visible");
    expect(rememberedArtwork(42, "wide")).toContain("/42/header.jpg");
  });
  it("trata como rota una imagen diminuta (el marcador de Steam)", async () => {
    act(() => root.render(<GameWideArt game={{ app_id: 42, name: "Celeste" }} />));
    const first = image()!.getAttribute("src");
    await fire("load", { width: 1, height: 1 });
    expect(image()!.getAttribute("src")).not.toBe(first);
  });
  it("si todo falla pregunta a Steam por la ruta con hash y, sin ella, muestra el título, nunca una imagen rota", async () => {
    act(() => root.render(<GameWideArt game={{ app_id: 42, name: "Celeste" }} />));
    while (image()) await fire("error");
    await act(async () => { await Promise.resolve(); });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".ga-art-fallback")?.textContent).toBe("Celeste");
  });
  it("usa la ruta con hash que devuelve Steam cuando las otras fallaron", async () => {
    resolve.mockResolvedValue("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/abc/header.jpg");
    act(() => root.render(<GameWideArt game={{ app_id: 42, name: "Celeste" }} />));
    while (image() && !image()!.getAttribute("src")!.includes("/abc/")) await fire("error");
    await act(async () => { await Promise.resolve(); });
    expect(image()!.getAttribute("src")).toContain("/42/abc/header.jpg");
  });
});

describe("una portada sin arte vertical", () => {
  it("prueba las portadas, después la imagen ancha entera con el título y nunca deja la tarjeta rota", async () => {
    vi.useFakeTimers();
    try {
      const game = { id: 1, app_id: 42, name: "Celeste" } as CatalogGame;
      act(() => root.render(<SteamCover game={game} />));
      await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
      expect(image()!.getAttribute("src")).toContain("library_600x900");
      // A landscape picture is refused as a portrait, like a broken one.
      await fire("load", { width: 460, height: 215 });
      while (image()?.getAttribute("src")?.includes("library_600x900")) await fire("error");
      expect(host.querySelector(".ga-art-composed-title")?.textContent).toBe("Celeste");
      await fire("load");
      expect(host.querySelector(".ga-art-composed")?.hasAttribute("data-loaded")).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
