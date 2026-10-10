import { beforeEach, expect, it, vi } from "vitest";
const native=vi.hoisted(()=>({uninstall:vi.fn(),active:vi.fn(()=>false)}));
vi.mock("./catalog/DigitalDownloadService",()=>({digitalDownloadService:{uninstall:native.uninstall,hasActiveDownloads:native.active}}));
vi.mock("./narrationLog",()=>({narrate:vi.fn()}));
const game={id:7,app_id:70,name:"Fixture"} as import("./types").CatalogGame;
beforeEach(()=>{
 vi.resetModules(); native.uninstall.mockReset().mockResolvedValue(undefined); native.active.mockReset().mockReturnValue(false);
 const data=new Map<string,string>();
 vi.stubGlobal("localStorage",{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});
});
it("keeps library membership independent from installation and survives reload",async()=>{
 const {libraryMembership}=await import("./libraryMembership");
 libraryMembership.add(game);
 expect(libraryMembership.has(game)).toBe(true);
 expect(JSON.parse(localStorage.getItem("gameaccess.library.v1")!)).toHaveLength(1);
 vi.resetModules();
 const reloaded=(await import("./libraryMembership")).libraryMembership;
 expect(reloaded.has({...game,id:999})).toBe(true);
});
it("removes membership only after a successful uninstall",async()=>{
 const {libraryMembership}=await import("./libraryMembership");
 const {removeLibraryGame}=await import("./libraryActions");
 libraryMembership.add(game);
 native.uninstall.mockRejectedValueOnce(new Error("locked file"));
 await expect(removeLibraryGame(game)).rejects.toThrow("locked file");
 expect(libraryMembership.has(game)).toBe(true);
 await removeLibraryGame(game);
 expect(native.uninstall).toHaveBeenCalledWith(game);
 expect(libraryMembership.has(game)).toBe(false);
});
it("clears the library progressively and keeps games whose uninstall fails",async()=>{
 const {libraryMembership}=await import("./libraryMembership");
 const {clearGameLibrary}=await import("./libraryActions");
 libraryMembership.add(game);libraryMembership.add({...game,id:8,app_id:80,name:"Other"});
 native.uninstall.mockRejectedValueOnce(new Error("locked"));
 await expect(clearGameLibrary()).rejects.toThrow("locked");
 expect(libraryMembership.getGames()).toEqual([game]);
 expect(libraryMembership.isBusy()).toBe(false);
});
it("refuses bulk removal while downloads are active",async()=>{
 const {libraryMembership}=await import("./libraryMembership");const {clearGameLibrary}=await import("./libraryActions");
 libraryMembership.add(game);native.active.mockReturnValue(true);
 await expect(clearGameLibrary()).rejects.toThrow("descargas");
 expect(native.uninstall).not.toHaveBeenCalled();expect(libraryMembership.has(game)).toBe(true);
});
it("migration runs once and never re-adds a removed game",async()=>{
 const {libraryMembership}=await import("./libraryMembership");
 libraryMembership.migrate([game]);libraryMembership.remove(game);libraryMembership.migrate([game]);
 expect(libraryMembership.getGames()).toEqual([]);
});
