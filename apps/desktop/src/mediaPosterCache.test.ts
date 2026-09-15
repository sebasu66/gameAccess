import { afterEach, expect, it, vi } from "vitest";
import { cacheMediaPoster, mediaPosterSize, readMediaPoster } from "./mediaPosterCache";
afterEach(()=>vi.unstubAllGlobals());
it("bounds thumbnails without enlarging or distorting them",()=>{expect(mediaPosterSize(1920,1080)).toEqual({width:480,height:270});expect(mediaPosterSize(320,180)).toEqual({width:320,height:180});});
it("never returns another game's cached image",async()=>{
 vi.stubGlobal("document",{createElement:()=>({getContext:()=>({drawImage:()=>undefined}),toDataURL:()=>"data:image/webp;base64,AAAA"})});
 cacheMediaPoster(42,{} as CanvasImageSource,1920,1080);
 expect(await readMediaPoster(42)).toBe("data:image/webp;base64,AAAA");expect(await readMediaPoster(43)).toBeNull();
});
