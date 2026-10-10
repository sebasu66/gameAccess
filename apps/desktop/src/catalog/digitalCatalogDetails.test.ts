import { afterEach, describe, expect, it, vi } from "vitest";
import { DigitalCatalog } from "./DigitalCatalog";
import type { CatalogGame } from "../types";
const mocks = vi.hoisted(() => ({ native: vi.fn(), steam: vi.fn(), store: vi.fn() }));
vi.mock("../native", () => ({hasTauriRuntime:mocks.native, getSteamStoreMetadata:mocks.steam}));
vi.mock("../catalogCache", () => ({readCatalogCachedDetail:vi.fn().mockResolvedValue(null), storeCatalogCachedDetail:mocks.store}));
vi.mock("../settings", () => ({getApiBaseUrl:vi.fn().mockResolvedValue("https://old-api.test")}));
vi.mock("../bundledArtwork", () => ({applyBundledDetails:async (value:unknown)=>value, applyBundledCatalogArtwork:async (value:unknown)=>value}));
vi.mock("../useSteamMetadataWorker", () => ({cachedSteamCatalogMetadata:async()=>({}), applySteamCatalogMetadata:(value:unknown)=>value}));
vi.mock("../narrationLog", () => ({narrate:vi.fn()}));
const game = {id:7, app_id:100, name:"Fixture", genres:["Action"]} as CatalogGame;
afterEach(()=>{vi.resetAllMocks();vi.unstubAllGlobals();});
describe("Game detail with an unavailable central API", () => {
  it("loads descriptions, requirements and media from public Steam before contacting the old server", async () => {
    mocks.native.mockReturnValue(true);
    mocks.store.mockResolvedValue(undefined);
    mocks.steam.mockResolvedValue({name:"Fixture", short_description:"Full summary", about_the_game:"Full description",
      pc_requirements:{minimum:"Minimum"}, screenshots:[{path_full:"https://steam.test/full.jpg"}],
      movies:[{mp4:{max:"https://steam.test/trailer.mp4"}}], genres:[{description:"Action"}]});
    const fetcher = vi.fn().mockRejectedValue(new Error("old server unavailable"));
    vi.stubGlobal("fetch",fetcher);
    const details = await new DigitalCatalog({catalogLoader:async()=>[game]}).loadDetails(100);
    expect(details.steam).toMatchObject({about_the_game:"Full description",minimum_requirements:"Minimum"});
    expect(details.steam?.screenshots?.[0].full).toBe("https://steam.test/full.jpg");
    expect(details.steam?.movies?.[0].mp4).toBe("https://steam.test/trailer.mp4");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.store).toHaveBeenCalledWith(7,expect.any(String),"ar",details);
  });
  it("keeps the catalog detail when Steam fails and the server has no details endpoint", async () => {
    mocks.native.mockReturnValue(true);
    mocks.steam.mockRejectedValue(new Error("Steam unavailable"));
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:404}));
    const details = await new DigitalCatalog({catalogLoader:async()=>[game]}).loadDetails(100);
    expect(details.name).toBe("Fixture");
    expect(details.steam?.genres).toEqual(["Action"]);
  });
});
