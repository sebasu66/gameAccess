import { describe, expect, it } from "vitest";
import { personalOrderActive, personalOrderState, publishTasteReadiness, setPersonalOrder, unlockCelebrated } from "./personalOrder";

describe("personalized order switch", () => {
  it("unlocks when the profile becomes ready during the session, not when it starts ready", () => {
    publishTasteReadiness(false, 40);
    expect(personalOrderState().unlocked).toBe(false);
    publishTasteReadiness(true, 78);
    expect(personalOrderState()).toMatchObject({ ready: true, percent: 78, unlocked: true });
    unlockCelebrated();
    expect(personalOrderState().unlocked).toBe(false);
    publishTasteReadiness(true, 80);
    expect(personalOrderState().unlocked).toBe(false);
  });

  it("tailors only when switched on and ready", () => {
    publishTasteReadiness(true, 80);
    setPersonalOrder(true);
    expect(personalOrderActive()).toBe(true);
    publishTasteReadiness(false, 50);
    expect(personalOrderActive()).toBe(false);
    setPersonalOrder(false);
  });
});
