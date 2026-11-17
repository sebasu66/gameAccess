import {afterEach,describe,expect,it,vi} from "vitest";
import {DigitalCatalog} from "./DigitalCatalog";
vi.mock("../settings",()=>({getApiBaseUrl:async()=>"http://catalog.test",getCatalogManifestUrl:async()=>""}));
afterEach(()=>vi.unstubAllGlobals());
describe("authoritative Digital refresh",()=>{
  it("fails without bundled data and never downloads the whole catalog from the server",async()=>{
    vi.stubGlobal("window",{});const fetch=vi.fn(async(_input:string)=>({ok:true,json:async()=>[]}));vi.stubGlobal("fetch",fetch);
    await expect(new DigitalCatalog().loadCatalog({requireRemote:true})).rejects.toThrow("El catálogo remoto no está disponible.");
    expect(fetch.mock.calls.some(args=>String(args[0]).endsWith("/library/catalog"))).toBe(false);
    expect(fetch.mock.calls.some(args=>String(args[0]).includes("digital_catalog.json"))).toBe(false);
  });
});
