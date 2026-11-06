import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({base:vi.fn(),invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:mocks.invoke}));
vi.mock("./settings",()=>({getApiBaseUrl:mocks.base,boundedFetch:(fetcher:unknown)=>fetcher}));
vi.mock("./i18n",()=>({translate:(key:string)=>key,translateServerDetail:(value:string)=>value}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();vi.stubGlobal("window",{__TAURI_INTERNALS__:{},dispatchEvent:vi.fn()});vi.stubGlobal("localStorage",{getItem:vi.fn(),setItem:vi.fn(),removeItem:vi.fn()});});
describe("activation authority continuity",()=>{
 it("validates the issued token with the same authority if a concurrent health probe loses the cached URL",async()=>{
  const base="http://127.0.0.1:38147";
  mocks.base.mockResolvedValueOnce(base).mockResolvedValue("");
  mocks.invoke.mockImplementation(async(command:string)=>{
   if(command==="activation_installation_id")return "00000000-0000-4000-8000-000000000001";
   if(command==="activation_check_access")return {active:true,cacheable:false,access_tier:"plus",expires_at:"2026-12-01T00:00:00Z",server_time:"2026-10-10T00:00:00Z"};
   return null;
  });
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({session_token:"test-session-token-with-enough-characters",cacheable:false}),{status:200})));
  const {redeemActivation}=await import("./activation");
  expect((await redeemActivation("TEST-KEY-ONLY")).active).toBe(true);
  expect(mocks.base).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledWith("activation_check_access",{apiUrl:base,sessionToken:"test-session-token-with-enough-characters"});
 });
});
