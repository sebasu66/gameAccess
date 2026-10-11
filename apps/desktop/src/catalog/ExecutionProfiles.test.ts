import {beforeEach,describe,it,expect,vi} from "vitest";
import {invoke} from "@tauri-apps/api/core";
import {ensureExecutionProfile,parseExecutionProfile} from "./ExecutionProfiles";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
vi.mock("../narrationLog",()=>({narrate:vi.fn()}));
vi.mock("./PluginRuntime",()=>({providerAvailable:()=>true}));
beforeEach(()=>vi.clearAllMocks());
describe("optional local/plugin profiles",()=>{
 it("plays without contacting a server or an absent plugin",async()=>{
  vi.mocked(invoke).mockImplementation(async(command)=>command==="get_registered_plugins"?[]:null);
  const request=vi.spyOn(globalThis,"fetch");
  expect((await ensureExecutionProfile(10)).archivePasswords).toEqual([]);
  expect(request).not.toHaveBeenCalled();request.mockRestore();
 });
 it("keeps user manual settings instead of replacing them with plugin defaults",async()=>{
  vi.mocked(invoke).mockResolvedValue({version:1,origin:"manual",archivePasswords:["fixture"],beforePlay:[]});
  expect((await ensureExecutionProfile(10)).archivePasswords).toEqual(["fixture"]);
  expect(invoke).toHaveBeenCalledTimes(1);
 });
 it("gets passwords and steps from a provider, with no GameAccess endpoint",async()=>{
  vi.mocked(invoke).mockImplementation(async(command)=>command==="get_registered_plugins"?[{id:"p",type:"source_provider",endpoint:"http://127.0.0.1:45000"}]:null);
  const request=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({archivePasswords:["fixture"],beforePlay:[]})));
  await ensureExecutionProfile(12);
  expect(request).toHaveBeenCalledWith("http://127.0.0.1:45000/api/execution-profile?app_id=12",expect.anything());
  expect(invoke).toHaveBeenCalledWith("save_execution_profile",expect.objectContaining({appId:12}));
  request.mockRestore();
 });
 it("retains the selected source profile instead of overwriting it with another provider default",async()=>{
  const profile={version:1,origin:"plugin",archivePasswords:["selected-source"],beforePlay:[]};
  vi.mocked(invoke).mockResolvedValue(profile);
  expect(await ensureExecutionProfile(10)).toEqual(profile);
  expect(invoke).toHaveBeenCalledTimes(1);
 });
 it("rejects shell profiles",()=>expect(()=>parseExecutionProfile({beforePlay:[{type:"shell"}]})).toThrow());
});
