import {beforeEach,describe,it,expect,vi} from "vitest";
import {render,screen,waitFor,cleanup} from "@testing-library/react";
const invoke=vi.hoisted(()=>vi.fn());
vi.mock("@tauri-apps/api/core",()=>({invoke}));
vi.mock("./native",()=>({hasTauriRuntime:()=>true}));
vi.mock("./settings",()=>({getApiBaseUrl:async()=>"http://fixture"}));
vi.mock("./narrationLog",()=>({narrate:vi.fn()}));
vi.mock("./i18n",()=>({useI18n:()=>({locale:"es"})}));
import CooptimusDetails from "./CooptimusDetails";
describe("cooperative detail enrichment",()=>{
 beforeEach(()=>{cleanup();vi.clearAllMocks();});
 it("renders verified player numbers without replacing Steam information",async()=>{
  invoke.mockResolvedValue({app_id:123,state:"ready",local_players_max:2,online_players_max:4,coop_campaign:true});
  render(<><p>Información de Steam preservada</p><CooptimusDetails appId={123} name="Fixture"/></>);
  expect(screen.getByRole("status").textContent).toContain("Consultando");
  await waitFor(()=>expect(screen.getByText("4 jugadores")).toBeTruthy());
  expect(screen.getByText("2 jugadores")).toBeTruthy();
  expect(screen.getByText("Información de Steam preservada")).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("query_cooptimus",{appId:123,gameName:"Fixture"});
 });
 it("rejects metadata from a different Steam game",async()=>{
  invoke.mockResolvedValue({app_id:999,state:"ready",online_players_max:99});
  render(<CooptimusDetails appId={124} name="Another"/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Volver a consultar"})).toBeTruthy());
  expect(screen.queryByText("99 jugadores")).toBeNull();
 });
});
