// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { pixelReveal } from "./detailMorph";

describe("pixel reveal after closing a game detail", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

  it("draws inside the card, so the squares follow the grid while it moves", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
    const art = document.createElement("span");
    const image = document.createElement("img");
    Object.defineProperties(image, { naturalWidth: { value: 460 }, naturalHeight: { value: 215 } });
    art.append(image);
    document.body.append(art);
    Object.defineProperties(art, { clientWidth: { value: 200 }, clientHeight: { value: 300 } });
    art.getBoundingClientRect = () => ({ left: 10, top: 20, right: 210, bottom: 320, width: 200, height: 300, x: 10, y: 20, toJSON() {} });
    art.style.opacity = "0";

    pixelReveal(art);

    const canvas = document.querySelector<HTMLCanvasElement>(".ga-pixel-reveal");
    expect(canvas?.parentElement).toBe(art);
    expect(canvas?.style.left).toBe("");
    expect(art.style.position).toBe("relative");
    expect(art.dataset.revealing).toBe("true");
    expect(art.style.opacity).toBe("1");
  });
});
