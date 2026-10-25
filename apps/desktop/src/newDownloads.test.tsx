// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogGame } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const game = (app_id: number, name: string): CatalogGame => ({ id: app_id, app_id, slug: name.toLowerCase(), name, credit_cost_per_hour: 0, copies_total: 1, copies_available: 1 });
const catalog = [game(30, "Gamma"), game(40, "Delta")];
const mocks = vi.hoisted(() => ({ openPanel: vi.fn(), query: vi.fn() }));
vi.mock("./desk/desk", () => ({ openPanel: mocks.openPanel, closePanel: vi.fn(), isWideDesk: () => false }));
vi.mock("./catalogCache", () => ({ queryCatalogCache: mocks.query }));
vi.mock("./narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./centralDialog/announcements", async original => ({ ...(await original<object>()), loadAnnouncements: async () => [] }));

/** A fresh copy of the app's modules, as after a restart (the stored news survive in localStorage). */
async function app() {
  vi.resetModules();
  const downloads = await import("./newDownloads");
  const news = await import("./centralDialog/useAnnouncements");
  const notice = await import("./notice/notice");
  const { translate } = await import("./i18n");
  const { default: NewsPanel } = await import("./NewsPanel");
  news.refreshNews();
  return { ...downloads, ...news, ...notice, translate, NewsPanel };
}

let root: Root | null = null;
beforeEach(() => {
  localStorage.clear();
  mocks.openPanel.mockReset();
  mocks.query.mockImplementation(async ({ app_ids }: { app_ids: number[] }) => ({ items: catalog.filter(item => app_ids.includes(item.app_id!)), total: app_ids.length }));
});
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.useRealTimers(); });

describe("new downloads: notice, news item and bell", () => {
  it("a finding shows the notice with OK and More and the 3 s timer; More opens the News panel", async () => {
    const { recordNewDownloads, getNotice, translate } = await app();
    recordNewDownloads([30, 40], "catalog");
    const notice = getNotice()!;
    expect(notice).toMatchObject({ title: translate("newDownloadsTitle"), text: translate("newDownloadsTextMany", { count: 2 }), timer: true });
    expect(notice.actions.map(action => action.label)).toEqual([translate("noticeOk"), translate("newDownloadsMore")]);
    notice.actions[1].run();
    expect(mocks.openPanel).toHaveBeenCalledWith("news");
    expect(getNotice()).toBeNull();
  });

  it("the item counts on the bell until the panel is opened, also after a restart, then stays read", async () => {
    let session = await app();
    session.recordNewDownloads([30], "plugin");
    expect(session.newsSnapshot().unread).toBe(1);
    session = await app(); // restart without opening the panel
    expect(session.newsSnapshot().unread).toBe(1);
    expect(session.newsSnapshot().items[0]).toMatchObject({ title: session.translate("newDownloadsNewsTitle"), games: [30] });
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root!.render(<session.NewsPanel games={[]} onOpenGame={() => undefined} />));
    expect(session.newsSnapshot().unread).toBe(0);
    session = await app();
    expect(session.newsSnapshot().unread).toBe(0);
    expect(session.newsSnapshot().items).toHaveLength(1);
  });

  it("the News panel lists the games and View opens each game's page", async () => {
    const session = await app();
    session.recordNewDownloads([40, 30], "catalog");
    const onOpenGame = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root!.render(<session.NewsPanel games={[]} onOpenGame={onOpenGame} />));
    const rows = [...container.querySelectorAll(".ga-news-latest .ga-news-games li")];
    expect(rows.map(row => row.querySelector("b")?.textContent)).toEqual(["Delta", "Gamma"]);
    act(() => rows[1].querySelector("button")!.click());
    expect(onOpenGame).toHaveBeenCalledWith(expect.objectContaining({ app_id: 30, name: "Gamma" }));
  });

  it("games already reported are not reported again", async () => {
    const session = await app();
    expect(session.recordNewDownloads([30], "catalog")).not.toBeNull();
    session.hideNotice();
    expect(session.recordNewDownloads([30], "plugin")).toBeNull();
    expect(session.getNotice()).toBeNull();
    expect(session.recordNewDownloads([30, 40], "plugin")?.appIds).toEqual([40]);
  });
});
