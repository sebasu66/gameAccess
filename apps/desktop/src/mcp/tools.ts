/**
 * The tools Game Access offers to the player's own AI (mcp_server.rs is the door; bridge.ts hands requests here).
 * Each tool runs the interface's own code, the same the buttons use, so what an AI does and what the screen shows never
 * disagree. Names, descriptions and answers are in English for the AI; it talks to the player in their language.
 */

/** A JSON Schema for a tool's arguments (MCP `inputSchema`). */
export type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** MCP hints: a read-only tool changes nothing; a destructive one deletes something (it asks the player first). */
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run(args: Record<string, unknown>): Promise<unknown>;
  /** Only listed and callable with Settings › AI control › developer tools on. */
  developer?: boolean;
}

/** A tool's answer given as MCP content as it is (a picture), instead of data turned into text. */
export class ToolContent {
  constructor(readonly content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>) {}
}

/** A tool's own refusal, said to the AI as it is (bad arguments, a game that is not there). */
export class ToolError extends Error {}

const registry = new Map<string, McpTool>();

export function registerTools(tools: McpTool[]): void {
  for (const tool of tools) registry.set(tool.name, tool);
}

export function listTools(developer = false) {
  return [...registry.values()].filter(tool => developer || !tool.developer).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } }));
}

/** One `tools/call`: the answer as MCP content, both as text and as structured data. Failures are tool errors. */
export async function callTool(name: string, args: Record<string, unknown> = {}, developer = false) {
  const tool = registry.get(name);
  if (!tool || (tool.developer && !developer)) return { content: [{ type: "text", text: tool ? `${name} is a developer tool: turn them on in Game Access › Settings › AI control.` : `Unknown tool: ${name}` }], isError: true };
  try {
    const result = await tool.run(args ?? {});
    if (result instanceof ToolContent) return { content: result.content };
    const structured = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : { result };
    return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
  } catch (failure) {
    const text = failure instanceof Error ? failure.message : String(failure);
    return { content: [{ type: "text", text }], isError: true };
  }
}

// ---- Argument helpers ----

export const str = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new ToolError(`"${key}" must be text`);
  return value.trim();
};

export const num = (args: Record<string, unknown>, key: string, { min, max }: { min?: number; max?: number } = {}): number | undefined => {
  const value = args[key];
  if (value == null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new ToolError(`"${key}" must be a number`);
  if (min != null && parsed < min) return min;
  if (max != null && parsed > max) return max;
  return parsed;
};

export const list = (args: Record<string, unknown>, key: string): string[] => {
  const value = args[key];
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new ToolError(`"${key}" must be a list of text`);
  return (value as string[]).map(item => item.trim()).filter(Boolean);
};

export const bool = (args: Record<string, unknown>, key: string): boolean | undefined => {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== "boolean") throw new ToolError(`"${key}" must be true or false`);
  return value;
};

/** Bytes as the AI can say them: 12.3 (GB). */
export const gb = (bytes: number | null | undefined): number | null => bytes == null ? null : Math.round(bytes / 1e8) / 10;
