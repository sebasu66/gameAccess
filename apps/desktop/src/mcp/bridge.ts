/**
 * The window's side of the MCP door (mcp_server.rs): each request the player's AI sends arrives here as the
 * "gameaccess:mcp-request" event, runs in the interface's own code and goes back with `mcp_reply`.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { actionTools } from "./actionTools";
import { discoverTools } from "./discoverTools";
import { libraryTools } from "./libraryTools";
import { callTool, listTools, registerTools } from "./tools";

interface McpRequest { id: number; method: "tools/list" | "tools/call"; params?: { name?: string; arguments?: Record<string, unknown> } }

export async function answer(request: McpRequest): Promise<unknown> {
  if (request.method === "tools/list") return { tools: listTools() };
  return callTool(request.params?.name ?? "", request.params?.arguments ?? {});
}

let started = false;

/** From App, once: registers the tools and starts listening. Harmless when the door is off (nothing is sent). */
export function startMcpBridge(): void {
  if (started || !isTauri()) return;
  started = true;
  registerTools([...discoverTools, ...libraryTools, ...actionTools]);
  void listen<McpRequest>("gameaccess:mcp-request", async event => {
    const request = event.payload;
    try {
      await invoke("mcp_reply", { id: request.id, result: await answer(request), error: null });
    } catch (failure) {
      await invoke("mcp_reply", { id: request.id, result: null, error: failure instanceof Error ? failure.message : String(failure) }).catch(() => undefined);
    }
  }).then(() => invoke("mcp_bridge_ready")).catch(() => { started = false; });
}
