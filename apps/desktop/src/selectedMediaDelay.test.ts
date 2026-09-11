import { afterEach, expect, it, vi } from "vitest";
import { scheduleSelectedMedia } from "./selectedMediaDelay";
afterEach(() => vi.useRealTimers());
it("loads only the settled selection after two seconds", () => {
 vi.useFakeTimers(); const loadA=vi.fn(), loadB=vi.fn();
 const cancelA=scheduleSelectedMedia(loadA); vi.advanceTimersByTime(1900); expect(loadA).not.toHaveBeenCalled(); cancelA();
 scheduleSelectedMedia(loadB); vi.advanceTimersByTime(1999); expect(loadB).not.toHaveBeenCalled(); vi.advanceTimersByTime(1);
 expect(loadA).not.toHaveBeenCalled(); expect(loadB).toHaveBeenCalledTimes(1);
});
