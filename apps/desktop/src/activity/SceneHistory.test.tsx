// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity";
import { SceneHistory } from "./ActivityPanel";

vi.mock("../i18n", async importOriginal => {
  const original = await importOriginal<typeof import("../i18n")>();
  return { ...original, useI18n: () => ({ t: (key: string) => key, locale: "es" }) };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const entry = (id: string, state: ActivityEntry["state"], tone: ActivityEntry["tone"]): ActivityEntry => ({
  id, key: id, title: id, state, tone, startedAt: Date.now(), seen: false,
});

describe("scene activity history", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  afterEach(() => { act(() => root.render(null)); });

  it("shows only available severity filters and filters entries without deleting them", () => {
    act(() => root.render(<SceneHistory entries={[entry("error-entry", "failed", "error"), entry("done-entry", "done", "ok")]} />));
    expect(host.textContent).toContain("error-entry");
    expect(host.textContent).toContain("done-entry");
    expect(host.querySelector('[aria-label="sceneActivityWarning"]')).toBeNull();
    const error = host.querySelector<HTMLButtonElement>('button[aria-label="sceneActivityError"]')!;
    act(() => error.click());
    expect(host.textContent).toContain("error-entry");
    expect(host.textContent).not.toContain("done-entry");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="sceneActivityAll"]')!.click());
    expect(host.textContent).toContain("done-entry");
  });
});
