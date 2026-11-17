// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ uninstallPlugin: vi.fn(), setPluginEnabled: vi.fn() }));
vi.mock("./catalog/PluginManage", async original => ({ ...await original<typeof import("./catalog/PluginManage")>(), ...native }));
vi.mock("./library-manager/ManualLinkDialog", () => ({ default: ({ url, query }: { url: string; query: string }) => <div data-testid="link-dialog" data-url={url} data-query={query} /> }));
const sources = vi.hoisted(() => ({ unregisterPluginSources: vi.fn() }));
vi.mock("./catalog/PluginSources", () => sources);
vi.mock("./catalog/PluginRuntime", () => ({ pollPluginRuntime: vi.fn(), getPluginStatuses: () => [], subscribePluginStatuses: () => () => undefined }));

import { PluginSection } from "./PluginSettings";
import { titleQuery } from "./PluginForm";
import { pluginUi, type PluginUi } from "./catalog/PluginManage";
import type { PluginStatus } from "./catalog/PluginRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const plugin: PluginStatus = { id: "sources", name: "Fuentes", endpoint: "http://127.0.0.1:45000", type: "source_provider", alive: true, revision: "1", instanceId: "a", dirty: false };
const ui: PluginUi = { schema: 1, description: "Reads download lists.", homepage: "https://example.test/plugin", sections: [
  { type: "list", id: "feeds", title: "Lists", path: "/api/manage/feeds", add: { placeholder: "https://…", label: "Add", pattern: "^https?://" } },
  { type: "search", id: "search", title: "Search", path: "/api/manage/search", placeholder: "Name", button: "Find", linkPath: "/api/manage/link" },
] };

let host: HTMLDivElement; let root: Root;
const calls: Array<{ url: string; method: string; body?: string }> = [];
function serve(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    const path = url.replace(plugin.endpoint, "").split("?")[0];
    const answer = routes[`${init?.method ?? "GET"} ${path}`];
    return new Response(JSON.stringify(answer ?? { error: "nope" }), { status: answer ? 200 : 404 });
  }));
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function mount(status = plugin) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<PluginSection plugin={status} focused={false} />));
  await settle(); await settle();
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); calls.length = 0; });
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("un plugin en Configuración › Plugins", () => {
  it("dibuja el formulario que comparte: su lista y su búsqueda", async () => {
    serve({
      "GET /api/ui": ui,
      "GET /api/manage/feeds": { items: ["https://example.test/a.json"], summary: "120 downloads" },
      "POST /api/manage/feeds": { items: ["https://example.test/a.json", "https://example.test/b.json"] },
      "GET /api/manage/search": { results: [{ title: "Cyberpunk 2077 v2.1 [Repack]", link: "https://host.test/page", meta: "60 GB · a" }] },
      "GET /api/manage/link": { url: "https://host.test/file.zip" },
    });
    await mount();
    expect(host.textContent).toContain("Reads download lists.");
    expect(host.querySelector<HTMLAnchorElement>(".ga-plugin-link")?.href).toBe("https://example.test/plugin");
    expect(host.textContent).toContain("https://example.test/a.json");
    expect(host.textContent).toContain("120 downloads");

    const add = host.querySelector<HTMLInputElement>('form:not([role="search"]) input')!;
    act(() => type(add, "https://example.test/b.json"));
    await act(async () => { add.form!.requestSubmit(); });
    await settle();
    expect(calls.find(call => call.method === "POST")?.body).toBe(JSON.stringify({ value: "https://example.test/b.json" }));
    expect(host.textContent).toContain("b.json");

    const search = host.querySelector<HTMLInputElement>('form[role="search"] input')!;
    act(() => type(search, "cyberpunk"));
    await act(async () => { search.form!.requestSubmit(); });
    await settle();
    const row = host.querySelector(".ga-plugin-results li")!;
    expect(row.textContent).toContain("60 GB · a");
    act(() => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    const download = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"], .lm-row-menu button')).find(button => /descargar|download/i.test(button.textContent ?? ""))!;
    await act(async () => { download.click(); });
    await settle();
    const dialog = host.querySelector<HTMLElement>('[data-testid="link-dialog"]');
    expect(dialog?.dataset.url).toBe("https://host.test/file.zip");
    expect(dialog?.dataset.query).toBe("Cyberpunk 2077");
  });

  it("un torrent de los resultados muestra sus archivos y tamaños, y si nadie responde lo dice", async () => {
    const withFiles: PluginUi = { ...ui, sections: [{ ...ui.sections[1], filesPath: "/api/manage/files" } as PluginUi["sections"][number]] };
    const results = [
      { title: "Big Game [Repack]", link: "magnet:?xt=urn:btih:aaa", meta: "44 GB", files: true },
      { title: "Big Game (direct)", link: "https://host.test/page", meta: "44 GB" },
    ];
    serve({ "GET /api/ui": withFiles, "GET /api/manage/search": { results },
      "GET /api/manage/files": { name: "Big Game", total: 47244640256 + 1024, files: [{ path: "Big Game/game.bin", size: 47244640256 }, { path: "Big Game/setup.exe", size: 1024 }] } });
    await mount();
    const search = host.querySelector<HTMLInputElement>('form[role="search"] input')!;
    act(() => type(search, "big"));
    await act(async () => { search.form!.requestSubmit(); });
    await settle();
    const [torrent, direct] = Array.from(host.querySelectorAll(".ga-plugin-results li"));
    const menuItems = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"], .lm-row-menu button'));
    act(() => { direct.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    expect(menuItems().some(button => /ver archivos|show files/i.test(button.textContent ?? ""))).toBe(false);
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await settle();
    act(() => { torrent.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    await act(async () => { menuItems().find(button => /ver archivos|show files/i.test(button.textContent ?? ""))!.click(); });
    await settle();
    const asked = calls.find(call => call.url.includes("/api/manage/files"))!;
    expect(asked.url).toContain("url=" + encodeURIComponent("magnet:?xt=urn:btih:aaa"));
    const rows = Array.from(host.querySelectorAll(".ga-plugin-files-list li")).map(row => row.textContent);
    expect(rows).toEqual(["game.bin44 GB", "setup.exe1.0 KB"]);
    expect(host.querySelector(".ga-plugin-files")?.textContent).toMatch(/2 (archivos|files)/);

    serve({ "GET /api/ui": withFiles, "GET /api/manage/search": { results } });
    act(() => { torrent.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    await act(async () => { menuItems().find(button => /ver archivos|show files/i.test(button.textContent ?? ""))!.click(); });
    await settle();
    expect(host.querySelector(".ga-plugin-files [role=alert]")?.textContent).toBe("nope");
    await act(async () => { host.querySelector<HTMLButtonElement>(".ga-plugin-files-head button")!.click(); });
    expect(host.querySelector(".ga-plugin-files")).toBeNull();
  });

  it("un plugin que no comparte formulario se muestra igual, con su aviso y desinstalar", async () => {
    serve({});
    await mount({ ...plugin, description: "From its manifest." });
    expect(host.textContent).toContain("From its manifest.");
    expect(host.querySelector("fieldset")).toBeNull();
    expect(host.querySelector(".ga-plugin-switch input")).not.toBeNull();
  });

  it("apagado no le pregunta nada, y al apagarlo saca sus fuentes del catálogo", async () => {
    serve({ "GET /api/ui": ui, "GET /api/manage/feeds": { items: [] } });
    await mount({ ...plugin, alive: false, enabled: false });
    expect(calls).toHaveLength(0);
    expect(host.querySelector<HTMLInputElement>(".ga-plugin-switch input")?.checked).toBe(false);
    act(() => root.unmount()); host.remove();

    await mount();
    await act(async () => { host.querySelector<HTMLInputElement>(".ga-plugin-switch input")!.click(); });
    await settle();
    expect(native.setPluginEnabled).toHaveBeenCalledWith("sources", false);
    expect(sources.unregisterPluginSources).toHaveBeenCalledWith("sources");
  });

  it("un plugin solo puede nombrar rutas de su propia dirección", async () => {
    serve({ "GET /api/ui": { schema: 1, sections: [
      { type: "list", id: "bad", title: "Bad", path: "https://evil.test/x" },
      { type: "list", id: "bad2", title: "Bad", path: "//evil.test/x" },
      { type: "search", id: "bad3", title: "Bad", path: "/ok", linkPath: "https://evil.test" },
      { type: "search", id: "bad5", title: "Bad", path: "/ok", filesPath: "https://evil.test/files" },
      { type: "html", id: "bad4", title: "Bad", path: "/ok" },
      { type: "list", id: "good", title: "Good", path: "/ok" },
    ] } });
    expect((await pluginUi(plugin, "es"))?.sections.map(section => section.id)).toEqual(["good"]);
  });
});

describe("titleQuery", () => {
  it("saca versión y grupo del título de una descarga", () => {
    expect(titleQuery("Cyberpunk 2077 v2.1 [SteamRIP]")).toBe("Cyberpunk 2077");
    expect(titleQuery("Some_Game.Build 123")).toBe("Some Game");
  });
});
