import { describe, expect, it } from "vitest";
import { beginLaunch, closeLaunch, getLaunch, launchFailed, launchLocked, launchOpened } from "./launchSession";
import type { CatalogGame } from "./types";

const game = { id: 1, app_id: 1, name: "Naruto" } as CatalogGame;

describe("launch session", () => {
  it("locks every other launch from the start until the dialog closes", () => {
    expect(launchLocked()).toBe(false);
    const session = beginLaunch(game);
    expect(launchLocked()).toBe(true);
    launchFailed(session.id, "boom");
    expect(getLaunch()).toMatchObject({ phase: "failed", error: "boom" });
    expect(launchLocked()).toBe(true);
    closeLaunch(session.id);
    expect(launchLocked()).toBe(false);
  });

  it("ignores the result of a launch that was closed or replaced", () => {
    const first = beginLaunch(game);
    closeLaunch(first.id);
    const second = beginLaunch(game);
    launchOpened(first.id);
    expect(getLaunch()?.phase).toBe("starting");
    launchOpened(second.id);
    expect(getLaunch()?.phase).toBe("opened");
    closeLaunch();
  });
});
