// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: Array<[string, unknown]> = [];
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args?: unknown) => { calls.push([command, args]); return null; }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("../native", () => ({ hasTauriRuntime: () => true }));

import AiStepsWindow from "./AiStepsWindow";
import { translate } from "../i18n";

const paste = async (field: HTMLInputElement, text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  await act(async () => { field.dispatchEvent(event); });
};

describe("AiStepsWindow", () => {
  let host: HTMLDivElement; let root: Root; let field: HTMLInputElement;
  beforeEach(async () => {
    calls.length = 0;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<AiStepsWindow />));
    field = document.querySelector("input.ga-steps-key")!;
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("shows the four steps and sends a pasted key at once, without its spaces", async () => {
    expect(document.querySelectorAll(".ga-step")).toHaveLength(4);
    await paste(field, "  abcdef0123456789.XYZ_-\n");
    expect(calls).toContainEqual(["ai_save_key", { key: "abcdef0123456789.XYZ_-" }]);
  });

  it("does not send what is not a key, and says so", async () => {
    await paste(field, "hello there");
    expect(calls).toEqual([]);
    expect(document.body.textContent).toContain(translate("aiBadKey"));
  });
});
