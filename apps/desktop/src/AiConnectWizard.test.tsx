// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: Array<[string, unknown]> = [];
const testResult: { error: string | null } = { error: null };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    calls.push([command, args]);
    if (command === "ai_test") { if (testResult.error) throw testResult.error; return "gemma4:31b-cloud"; }
    return null;
  }),
}));
const guide: { key?: (event: { payload: unknown }) => void; closed?: (event: { payload: unknown }) => void } = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    if (name === "gameaccess:ai-key") guide.key = handler;
    if (name === "gameaccess:ai-guide-closed") guide.closed = handler;
    return () => undefined;
  }),
}));
vi.mock("./native", () => ({ hasTauriRuntime: () => true }));

import AiConnectWizard from "./AiConnectWizard";
import { translate } from "./i18n";

const t = (key: Parameters<typeof translate>[0], params?: Parameters<typeof translate>[1]) => translate(key, params, "en");
const button = (label: string) => [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

describe("AiConnectWizard", () => {
  let host: HTMLDivElement; let root: Root; let done: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    calls.length = 0; testResult.error = null; done = vi.fn();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<AiConnectWizard onDone={done} />));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

  it("opens the browser and the steps, and the key pasted there is tried before Done", async () => {
    expect(document.body.textContent).toContain(t("aiIntroTitle"));
    await act(async () => button(t("aiConnect"))!.click());
    expect(calls.map(([command]) => command)).toContain("ai_guide_open");
    expect(document.body.textContent).toContain(t("aiWaiting"));
    await act(async () => guide.key!({ payload: { ending: "a91f" } }));
    await flush();
    expect(calls.map(([command]) => command)).toContain("ai_test");
    expect(document.body.textContent).toContain(t("aiConnected"));
    await act(async () => button(t("aiDone"))!.click());
    expect(done).toHaveBeenCalledWith(true);
  });

  it("a refused key opens the steps again", async () => {
    await act(async () => button(t("aiConnect"))!.click());
    testResult.error = "rejected";
    await act(async () => guide.key!({ payload: { ending: "a91f" } }));
    await flush();
    expect(document.body.textContent).toContain(t("aiError_rejected"));
    calls.length = 0;
    await act(async () => button(t("aiTryAnother"))!.click());
    await flush();
    expect(calls.map(([command]) => command)).toEqual(["ai_disconnect", "ai_guide_open"]);
    expect(document.body.textContent).toContain(t("aiGuideTitle"));
  });

  it("says so when the steps window closes without a key", async () => {
    await act(async () => button(t("aiConnect"))!.click());
    await act(async () => guide.closed!({ payload: { saved: false } }));
    expect(document.body.textContent).toContain(t("aiGuideClosed"));
    expect(button(t("aiOpenWindow"))).toBeTruthy();
  });
});
