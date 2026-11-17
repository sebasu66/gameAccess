import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {vi.unstubAllGlobals();vi.resetModules();});
it("shares volume and mute and preserves them across a new media session", async () => {
 const values=new Map<string,string>(); vi.stubGlobal("localStorage",{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
 const audio=await import("./sharedMediaAudio"); audio.setMediaVolume(.24); audio.setMediaMuted(false);
 expect(audio.readMediaAudio()).toEqual({volume:.24,muted:false});
 vi.resetModules(); const next=await import("./sharedMediaAudio"); expect(next.readMediaAudio()).toEqual({volume:.24,muted:false});
});
