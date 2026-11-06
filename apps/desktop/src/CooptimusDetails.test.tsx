import {beforeEach,describe,it,expect,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
const invoke=vi.hoisted(()=>vi.fn());
vi.mock("@tauri-apps/api/core",()=>({invoke}));
vi.mock("./native",()=>({hasTauriRuntime:()=>true}));
vi.mock("./settings",()=>({getApiBaseUrl:async()=>"http://fixture"}));
vi.mock("./narrationLog",()=>({narrate:vi.fn()}));
vi.mock("./i18n",()=>({useI18n:()=>({locale:"es"})}));
import CooptimusDetails,{loadCooptimusDetails,CoopFacts} from "./CooptimusDetails";
describe("cooperative detail enrichment",()=>{
 beforeEach(()=>{vi.clearAllMocks();});
 it("renders verified player numbers in compact fields",()=>{
  const html=renderToStaticMarkup(<CoopFacts es data={{app_id:123,state:"ready",local_players_max:2,online_players_max:4,coop_campaign:true}}/>);
  expect(html).toContain("4 jugadores");expect(html).toContain("2 jugadores");expect(html).toContain("Campaña cooperativa");
 });
 it("requests the public browser lookup and rejects another Steam game",async()=>{
  invoke.mockResolvedValue({app_id:999,state:"ready",online_players_max:99});
  expect(await loadCooptimusDetails(124,"Another")).toBeNull();
  expect(invoke).toHaveBeenCalledWith("query_cooptimus",{appId:124,gameName:"Another"});
 });
 it("shows loading instead of pretending that failed metadata is ready",()=>{
  expect(renderToStaticMarkup(<CooptimusDetails appId={125} name="Fixture"/>)).toContain("Consultando detalles");
 });
});
