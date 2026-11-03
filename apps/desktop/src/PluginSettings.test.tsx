// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const manage = vi.hoisted(() => ({
  pluginHealth: vi.fn(), pluginFeeds: vi.fn(), addPluginFeed: vi.fn(), addPluginFeedFile: vi.fn(), removePluginFeed: vi.fn(),
  searchPlugin: vi.fn(), pluginLink: vi.fn(), uninstallPlugin: vi.fn(),
}));
vi.mock("./catalog/PluginManage", async original => ({ ...await original<typeof import("./catalog/PluginManage")>(), ...manage }));
vi.mock("./library-manager/ManualLinkDialog", () => ({ default: ({ url, query }: { url: string; query: string }) => <div data-testid="link-dialog" data-url={url} data-query={query} /> }));
vi.mock("./catalog/PluginSources", () => ({ unregisterPluginSources: vi.fn() }));
vi.mock("./catalog/PluginRuntime", () => ({ pollPluginRuntime: vi.fn() }));

import PluginSettings, { titleQuery } from "./PluginSettings";
import type { PluginStatus } from "./catalog/PluginRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const plugin: PluginStatus = { id: "sources", name: "Fuentes", endpoint: "http://127.0.0.1:45000", type: "source", alive: true, revision: "1", instanceId: "a", dirty: false };
let host: HTMLDivElement; let root: Root;
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function mount(status = plugin) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<PluginSettings plugin={status} />));
  await settle();
}
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("la pestaña de un plugin en Configuración", () => {
  it("muestra sus listas, busca en sus registros y descarga un resultado con clic derecho", async () => {
    manage.pluginHealth.mockResolvedValue({ capabilities: ["sources", "manage"] });
    manage.pluginFeeds.mockResolvedValue({ feeds: ["https://example.test/a.json"], syncing: false, sourceCount: 120 });
    manage.searchPlugin.mockResolvedValue([{ title: "Cyberpunk 2077 v2.1 [Repack]", url: "https://host.test/page", size: "60 GB", source: "https://example.test/a.json" }]);
    manage.pluginLink.mockResolvedValue({ url: "https://host.test/file.zip", mode: "direct" });
    await mount();
    expect(host.textContent).toContain("https://example.test/a.json");
    expect(host.textContent).toContain("120 downloads");

    const search = host.querySelector<HTMLInputElement>('form[role="search"] input')!;
    act(() => type(search, "cyberpunk"));
    await act(async () => { host.querySelector<HTMLFormElement>('form[role="search"]')!.requestSubmit(); });
    await settle();
    expect(manage.searchPlugin).toHaveBeenCalledWith(plugin, "cyberpunk");
    const row = host.querySelector(".ga-plugin-results li")!;
    expect(row.textContent).toContain("60 GB · a");

    act(() => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    const download = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Download"))!;
    await act(async () => download.click());
    await settle();
    const dialog = host.querySelector<HTMLElement>('[data-testid="link-dialog"]')!;
    expect(dialog.dataset.url).toBe("https://host.test/file.zip");
    expect(dialog.dataset.query).toBe("Cyberpunk 2077");
  });

  it("un plugin viejo, sin la capacidad manage, solo se muestra y se puede desinstalar", async () => {
    manage.pluginHealth.mockResolvedValue({ capabilities: ["sources"] });
    await mount();
    expect(manage.pluginFeeds).not.toHaveBeenCalled();
    expect(host.querySelector('form[role="search"]')).toBeNull();
    expect(host.textContent).toContain("Update it");
    expect(host.textContent).toContain("Uninstall the plugin");
  });

  it("el nombre del juego sale del título de la descarga", () => {
    expect(titleQuery("Cyberpunk 2077 v2.1 [Repack]")).toBe("Cyberpunk 2077");
    expect(titleQuery("Hades (Build 39) [GOG]")).toBe("Hades");
    expect(titleQuery("Elden_Ring.Deluxe")).toBe("Elden Ring Deluxe");
  });
});
