import {afterEach,describe,expect,it,vi} from "vitest";
import {DigitalCatalog} from "./DigitalCatalog";
vi.mock("../settings",()=>({getApiBaseUrl:async()=>"http://catalog.test"}));
afterEach(()=>vi.unstubAllGlobals());
describe("authoritative Digital refresh",()=>{
  it("does not substitute bundled data when the server fails",async()=>{
    vi.stubGlobal("window",{}); const fetch=vi.fn(async()=>({ok:false,status:503}));vi.stubGlobal("fetch",fetch);
    await expect(new DigitalCatalog().loadCatalog({requireRemote:true})).rejects.toThrow("503");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("accepts an empty remote catalog without reintroducing bundled games",async()=>{
    vi.stubGlobal("window",{});const fetch=vi.fn(async(_input:string)=>({ok:true,json:async()=>[]}));vi.stubGlobal("fetch",fetch);
    expect(await new DigitalCatalog().loadCatalog({requireRemote:true})).toEqual([]);
    expect(fetch.mock.calls.filter(args=>String(args[0]).endsWith("/library/catalog"))).toHaveLength(1);
    expect(fetch.mock.calls.some(args=>String(args[0]).includes("digital_catalog.json"))).toBe(false);
  });
});
