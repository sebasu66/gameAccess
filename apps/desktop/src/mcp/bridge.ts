/**
 * The window's side of the MCP door (mcp_server.rs): each request the player's AI sends arrives here as the
 * "gameaccess:mcp-request" event, runs in the interface's own code and goes back with `mcp_reply`.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { actionTools } from "./actionTools";
import { devTools, startDevEvents } from "./devTools";
import { discoverTools } from "./discoverTools";
import { libraryTools } from "./libraryTools";
import { callTool, listTools, registerTools } from "./tools";

interface McpRequest { id: number; method: "tools/list" | "tools/call"; params?: { name?: string; arguments?: Record<string, unknown> } }

/** Whether the developer tools are on (Settings › AI control), asked on every request so the switch acts at once. */
const developerOn = async () => { try { return (await invoke<{ developer: boolean }>("mcp_state")).developer; } catch { return false; } };

export async function answer(request: McpRequest, developer?: boolean): Promise<unknown> {
  const dev = developer ?? (isTauri() ? await developerOn() : false);
  if (request.method === "tools/list") return { tools: listTools(dev) };
  return callTool(request.params?.name ?? "", request.params?.arguments ?? {}, dev);
}

let started = false;

/** From App, once: registers the tools and starts listening. Harmless when the door is off (nothing is sent). */
export function startMcpBridge(): void {
  if (started || !isTauri()) return;
  started = true;
  registerTools([...discoverTools, ...libraryTools, ...actionTools, ...devTools]);
  startDevEvents();
  void listen<McpRequest>("gameaccess:mcp-request", async event => {
    const request = event.payload;
    try {
      await invoke("mcp_reply", { id: request.id, result: await answer(request), error: null });
    } catch (failure) {
      await invoke("mcp_reply", { id: request.id, result: null, error: failure instanceof Error ? failure.message : String(failure) }).catch(() => undefined);
    }
  }).then(() => invoke("mcp_bridge_ready")).catch(() => { started = false; });
}
