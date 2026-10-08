import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogUpdater, CATALOG_REFRESH_INTERVAL } from "./catalogUpdates";
import type { CatalogGame } from "./types";
const game = (id:number) => ({id,name:`Game ${id}`} as CatalogGame);
afterEach(() => vi.useRealTimers());
function setup(load = vi.fn(async()=>[game(1),game(2)])) {
  const callbacks={load,apply:vi.fn(),added:vi.fn(),status:vi.fn(),error:vi.fn()};
  return {callbacks,updater:new CatalogUpdater([game(1)],callbacks)};
}
describe("client catalog updater",()=>{
  it("waits half an hour, detects additions once and stops on disposal",async()=>{
    vi.useFakeTimers(); const {updater,callbacks}=setup(); updater.start();
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INTERVAL-1); expect(callbacks.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(callbacks.added).toHaveBeenCalledWith([game(2)]);
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INTERVAL); expect(callbacks.added).toHaveBeenCalledTimes(1);
    updater.dispose(); await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INTERVAL); expect(callbacks.load).toHaveBeenCalledTimes(2);
  });
  it("deduplicates rows and shares manual/automatic requests in flight",async()=>{
    let resolve!:(games:CatalogGame[])=>void;
    const {updater,callbacks}=setup(vi.fn(()=>new Promise<CatalogGame[]>(r=>{resolve=r;})));
    const pending=updater.refresh(true); expect(updater.refresh()).toBe(pending);
    await Promise.resolve(); resolve([game(1),game(2),game(2)]); await pending;
    expect(callbacks.load).toHaveBeenCalledTimes(1); expect(callbacks.added).toHaveBeenCalledWith([game(2)]);
    expect(callbacks.apply).toHaveBeenCalledWith([game(1),game(2)]); updater.dispose();
  });
  it("keeps the baseline after failure; metadata changes and removals are not additions",async()=>{
    const load=vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce([{...game(1),name:"Updated title"},game(2)]).mockResolvedValueOnce([game(2)]);
    const {updater,callbacks}=setup(load); await updater.refresh(true); expect(callbacks.apply).not.toHaveBeenCalled();
    expect(callbacks.error).toHaveBeenCalledWith(expect.any(Error),true);
    await updater.refresh(); expect(callbacks.added).toHaveBeenCalledWith([game(2)]);
    await updater.refresh(); expect(callbacks.added).toHaveBeenCalledTimes(1); updater.dispose();
  });
  it("ignores a late response after unmount and catches up after sleep",async()=>{
    vi.useFakeTimers(); let resolve!:(games:CatalogGame[])=>void;
    const {updater,callbacks}=setup(vi.fn(()=>new Promise<CatalogGame[]>(r=>{resolve=r;})));
    vi.setSystemTime(Date.now()+CATALOG_REFRESH_INTERVAL); updater.catchUp(); await Promise.resolve();
    updater.dispose(); resolve([game(2)]); await Promise.resolve(); await Promise.resolve();
    expect(callbacks.apply).not.toHaveBeenCalled(); expect(callbacks.added).not.toHaveBeenCalled();
  });
});
