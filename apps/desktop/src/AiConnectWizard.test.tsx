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
    if (command === "ai_test") { if (testResult.error) throw testResult.error; return "gemma4:31b"; }
    if (command === "ai_save_key") return { connected: true, ending: "wxyz" };
    return null;
  }),
}));
const guide: { key?: (event: { payload: unknown }) => void; closed?: (event: { payload: unknown }) => void; google?: () => void } = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    if (name === "gameaccess:ai-key") guide.key = handler;
    if (name === "gameaccess:ai-guide-closed") guide.closed = handler;
    if (name === "gameaccess:ai-google") guide.google = () => handler({ payload: null });
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

  it("opens Ollama's window with the guide, and the key it takes is tried before Done", async () => {
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

  it("keeps the browser and a pasted key for Google, and a refused key asks for another", async () => {
    await act(async () => button(t("aiConnect"))!.click());
    await act(async () => guide.google!());
    expect(document.body.textContent).toContain(t("aiGoogleNote"));
    expect(button(t("aiUseKey"))!.disabled).toBe(true);
    const field = document.querySelector<HTMLInputElement>("input.ga-ai-field")!;
    testResult.error = "rejected";
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "sk-0123456789abcdefWXYZ");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button(t("aiUseKey"))!.disabled).toBe(false);
    await act(async () => button(t("aiUseKey"))!.click());
    await flush();
    expect(calls).toContainEqual(["ai_save_key", { key: "sk-0123456789abcdefWXYZ" }]);
    expect(document.body.textContent).toContain(t("aiError_rejected"));
    await act(async () => button(t("aiTryAnother"))!.click());
    await flush();
    expect(calls.map(([command]) => command)).toContain("ai_disconnect");
    expect(document.body.textContent).toContain(t("aiGuideTitle"));
  });

  it("says so when the Ollama window closes without a key", async () => {
    await act(async () => button(t("aiConnect"))!.click());
    await act(async () => guide.closed!({ payload: { saved: false } }));
    expect(document.body.textContent).toContain(t("aiGuideClosed"));
    expect(button(t("aiOpenWindow"))).toBeTruthy();
  });
});
