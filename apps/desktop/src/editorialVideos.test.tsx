import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EditorialGameVideo from "./EditorialGameVideo";
import { availableEditorialVideos, editorialEmbedUrl, selectEditorialVideo, type EditorialVideoCatalog } from "./editorialVideos";

const es = { youtubeId: "abcdefghijk", title: "Guía en español", publishedAt: "2026-10-10" };
const en = { youtubeId: "ABCDEFGHIJK", title: "English guide", publishedAt: "2026-10-10" };
const catalog: EditorialVideoCatalog = { "4078430": { es, en }, "42": { es } };

describe("published editorial video selection", () => {
  it("uses the requested language and falls back to Spanish when English is unpublished", () => {
    expect(selectEditorialVideo(4078430, "en", catalog)?.video).toBe(en);
    expect(selectEditorialVideo(42, "en", catalog)?.video).toBe(es);
    expect(selectEditorialVideo(4078430, "es", catalog)?.video).toBe(es);
  });
  it("keeps games without a published record on their existing media path", () => {
    expect(selectEditorialVideo(null, "es", catalog)).toBeUndefined();
    expect(selectEditorialVideo(99, "es", catalog)).toBeUndefined();
    expect(renderToStaticMarkup(<EditorialGameVideo appId={99} />)).toBe("");
  });
  it("rejects invalid IDs instead of allowing arbitrary iframe URLs", () => {
    expect(availableEditorialVideos(42, { "42": { es: { ...es, youtubeId: "https://other.example/" } } })).toEqual([]);
    expect(() => editorialEmbedUrl({ ...es, youtubeId: "../escape" }, "es")).toThrow();
    const url = new URL(editorialEmbedUrl(es, "es"));
    expect(url.hostname).toBe("www.youtube-nocookie.com");
    expect(url.searchParams.get("hl")).toBe("es");
    expect(url.searchParams.has("autoplay")).toBe(false);
  });
});
