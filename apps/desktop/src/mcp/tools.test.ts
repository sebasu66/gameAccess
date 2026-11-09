import { describe, expect, it } from "vitest";
import { answer } from "./bridge";
import { callTool, gb, list, num, registerTools, ToolError, type McpTool } from "./tools";
import { librarySummaryRow } from "./libraryTools";
import type { LibraryGame } from "../catalog/DigitalProcessManager";

const echo: McpTool = {
  name: "test_echo", title: "Echo", description: "Answers with its arguments.",
  inputSchema: { type: "object", properties: { n: { type: "number" } } },
  annotations: { readOnlyHint: true },
  run: async args => {
    if (args.fail) throw new ToolError("refused on purpose");
    return { n: num(args, "n", { max: 10 }) };
  },
};
registerTools([echo]);

describe("MCP tools", () => {
  it("lists a tool with its schema and hints", async () => {
    const listed = await answer({ id: 1, method: "tools/list" }) as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean; title: string } }> };
    const tool = listed.tools.find(item => item.name === "test_echo");
    expect(tool?.annotations).toEqual({ title: "Echo", readOnlyHint: true });
  });

  it("answers a call as text and as structured data", async () => {
    const result = await callTool("test_echo", { n: 50 });
    expect(result.structuredContent).toEqual({ n: 10 });
    expect(JSON.parse(result.content[0].text)).toEqual({ n: 10 });
    expect(result.isError).toBeUndefined();
  });

  it("says a refusal or an unknown tool as a tool error, not a failure", async () => {
    expect(await callTool("test_echo", { fail: true })).toMatchObject({ isError: true, content: [{ text: "refused on purpose" }] });
    expect(await callTool("nope")).toMatchObject({ isError: true });
  });

  it("checks arguments", () => {
    expect(() => list({ genres: "Action" }, "genres")).toThrow(ToolError);
    expect(list({ genres: [" Action ", ""] }, "genres")).toEqual(["Action"]);
    expect(() => num({ n: "x" }, "n")).toThrow(ToolError);
    expect(gb(12_345_678_901)).toBe(12.3);
  });

  it("describes a library game with its origin, room and idle days", () => {
    const row = librarySummaryRow({
      app_id: 7, name: "Fixture", state: "ready", installed: true, size_bytes: 5e9, frozen: "freeze", original_bytes: 5e9, frozen_bytes: 3e9,
      issues: [], standard: true, reclaimable_bytes: 0, transfer_bytes: null, transfer_active: false, folder: "x", needs_repair: false,
      error: "", warning: "", linked: true, link_kind: "steam", last_played: new Date(Date.now() - 3 * 86400000).toISOString(),
    } as LibraryGame);
    expect(row).toMatchObject({ origin: "steam", size_gb: 5, saved_by_freezing_gb: 2, days_since_played: 3, problem: null });
  });
});
