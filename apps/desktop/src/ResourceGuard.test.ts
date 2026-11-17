import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resourceGuard, RESOURCE_LIMITS } from "./ResourceGuard";
import * as uiSounds from "./uiSounds";

describe("ResourceGuard manager", () => {
  beforeEach(() => {
    resourceGuard.resetForTesting();
    resourceGuard.setDebugEnabled(false);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clamps requested cards to MAX_DOM_CARDS and triggers DOM_OVERFLOW_ATTEMPT alert", () => {
    const alerts: string[] = [];
    resourceGuard.onAlert(event => alerts.push(event.type));

    const result = resourceGuard.clampCardWindow(500, "test-shelf");
    expect(result).toBe(RESOURCE_LIMITS.MAX_DOM_CARDS);
    expect(alerts).toContain("DOM_OVERFLOW_ATTEMPT");
  });

  it("allows requests within safety limit without clamping or alerts", () => {
    const alerts: string[] = [];
    resourceGuard.onAlert(event => alerts.push(event.type));

    const result = resourceGuard.clampCardWindow(40, "test-shelf");
    expect(result).toBe(40);
    expect(alerts).toHaveLength(0);
  });

  it("alerts on DOM card spikes when mounted cards exceed safety limit", () => {
    const alerts: string[] = [];
    resourceGuard.onAlert(event => alerts.push(event.type));

    resourceGuard.trackMountedCards(150, "infinite-scroll");
    expect(alerts).toContain("DOM_CARD_SPIKE");
    expect(resourceGuard.getMetrics().mountedCards).toBe(150);
  });

  it("alerts when concurrent asynchronous tasks exceed the safety threshold", () => {
    const alerts: string[] = [];
    resourceGuard.onAlert(event => alerts.push(event.type));

    const releases: Array<() => void> = [];
    for (let i = 0; i < RESOURCE_LIMITS.MAX_CONCURRENT_FETCHES + 2; i++) {
      releases.push(resourceGuard.registerAsyncTask(`task-${i}`, "artwork"));
    }

    expect(alerts).toContain("ASYNC_CONCURRENCY_SPIKE");
    releases.forEach(release => release());
    expect(resourceGuard.getMetrics().activeTasks).toBe(0);
  });

  it("plays alert tone when debug mode is ON and suppresses sound when OFF", () => {
    const soundSpy = vi.spyOn(uiSounds, "playResourceAlertTone").mockImplementation(() => {});

    // Debug OFF: tone is NOT played
    resourceGuard.setDebugEnabled(false);
    resourceGuard.triggerAlert("TEST_SPIKE", "testing without sound");
    expect(soundSpy).not.toHaveBeenCalled();

    // Debug ON: tone IS played
    resourceGuard.setDebugEnabled(true);
    resourceGuard.triggerAlert("TEST_SPIKE_2", "testing with sound");
    expect(soundSpy).toHaveBeenCalledTimes(1);
  });

  it("sounds the tone for a burst of distinct alert types instead of swallowing it", () => {
    const soundSpy = vi.spyOn(uiSounds, "playResourceAlertTone").mockImplementation(() => {});
    resourceGuard.setDebugEnabled(true);

    // A scroll burst emits many different spikes within the same second; the
    // alert level must not swallow them, otherwise the alarm is silent.
    resourceGuard.triggerAlert("DOM_CARD_SPIKE", "burst");
    resourceGuard.triggerAlert("MEMORY_SPIKE", "burst");
    resourceGuard.triggerAlert("ASYNC_CONCURRENCY_SPIKE", "burst");

    expect(soundSpy).toHaveBeenCalledTimes(3);
  });

  it("sounds the growth siren only when a metric sets a new high", () => {
    const soundSpy = vi.spyOn(uiSounds, "playResourceAlertTone").mockImplementation(() => {});
    resourceGuard.setDebugEnabled(true);

    resourceGuard.trackMountedCards(148, "shelf");
    resourceGuard.triggerAlert("DOM_CARD_SPIKE", "148");
    resourceGuard.triggerAlert("DOM_CARD_SPIKE", "148 again");
    expect(soundSpy).toHaveBeenCalledTimes(1);

    // Escalating leak: each new high warns again.
    resourceGuard.trackMountedCards(208, "shelf");
    resourceGuard.triggerAlert("DOM_CARD_SPIKE", "208");
    resourceGuard.trackMountedCards(268, "shelf");
    resourceGuard.triggerAlert("DOM_CARD_SPIKE", "268");
    expect(soundSpy).toHaveBeenCalledTimes(3);

    // A dip then a return to the same count is not a new high.
    resourceGuard.trackMountedCards(100, "shelf");
    resourceGuard.triggerAlert("DOM_CARD_SPIKE", "100");
    resourceGuard.trackMountedCards(268, "shelf");
    resourceGuard.triggerAlert("DOM_CARD_SPIKE", "268 restored");
    expect(soundSpy).toHaveBeenCalledTimes(3);
  });

  it("toggles the profiler flag and notifies subscribers", () => {
    const seen: boolean[] = [];
    const unsubscribe = resourceGuard.subscribeDebug(enabled => seen.push(enabled));

    expect(resourceGuard.toggleDebug()).toBe(true);
    expect(resourceGuard.isDebugEnabled()).toBe(true);
    expect(resourceGuard.toggleDebug()).toBe(false);
    expect(resourceGuard.isDebugEnabled()).toBe(false);
    expect(seen).toEqual([true, false]);

    unsubscribe();
    resourceGuard.setDebugEnabled(true);
    expect(seen).toEqual([true, false]);
  });
});
