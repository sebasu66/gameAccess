import { expect, it } from "vitest";
import { applyInstalledSnapshot } from "./libraryStorageSnapshot";
import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
it("removes MK10's stale ready state without touching prepared or compressed games", () => {
 const status=(app_id:number,state:ManagedDownloadStatus["state"]) => ({ app_id,state,installed:state==="installed" }) as ManagedDownloadStatus;
 const next=applyInstalledSnapshot({307780:status(307780,"installed"),2:status(2,"prepared"),3:status(3,"frozen")},[]);
 expect(gameStateManager.resolve(next[307780]).playButtonReady).toBe(false);
 expect(gameStateManager.resolve(next[2]).playButtonReady).toBe(true);
 expect(gameStateManager.resolve(next[3]).playButtonReady).toBe(true);
});
it("does not enable Play during an update even if the old installation flag remains", () => {
 expect(gameStateManager.resolve({app_id:1,state:"downloading",installed:true} as ManagedDownloadStatus).playButtonReady).toBe(false);
});

it("uses the same resolved state for the ready badge and file actions after uninstall", () => {
 const state=gameStateManager.resolve({app_id:1519310,state:"not-installed",installed:false} as ManagedDownloadStatus);
 expect(state.playButtonReady).toBe(false);expect(state.canOpenInstallFolder).toBe(false);expect(state.canUninstall).toBe(false);
});
