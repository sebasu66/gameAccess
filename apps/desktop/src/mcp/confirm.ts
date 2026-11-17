/**
 * The player's say over what their AI does: before deleting something or taking a lot of room (uninstall, deep freeze,
 * a download, cancelling one), Game Access asks in its own notice (confirmNotice), with the window brought to the
 * front, and the AI only goes on if the player allows it. Settings can turn this off (mcp_server.rs, `confirm`).
 * Every action an AI starts also goes to the activity log, marked as asked by the AI.
 */
import { invoke } from "@tauri-apps/api/core";
import { translate, type TranslationKey } from "../i18n";
import { narrate } from "../narrationLog";
import { confirmNotice, getNotice, hideNotice } from "../notice/notice";
import { noticeGame } from "../notice/noticeGame";
import type { CatalogGame } from "../types";
import { ToolError } from "./tools";

/** How long the question waits for the player; the door gives a tool two minutes in all. */
export const ASK_TIMEOUT_MS = 100_000;

async function confirmOn(): Promise<boolean> {
  try { return (await invoke<{ confirm: boolean }>("mcp_state")).confirm; } catch { return true; }
}

/**
 * Asks the player to allow one action. Resolves when allowed (or when confirmations are off); throws a ToolError the AI
 * can repeat to the player when they say no or do not answer.
 */
export async function askPlayer(game: CatalogGame, action: TranslationKey, reason: string | undefined, kind: "danger" | "frost" | "primary" = "danger"): Promise<void> {
  const what = translate(action, { name: game.name });
  if (!(await confirmOn())) { void narrate(`IA: ${what}${reason ? ` (${reason})` : ""}`, { area: "AI" }); return; }
  void invoke("mcp_show_window").catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked: number | undefined;
  const answer = confirmNotice({
    game: noticeGame(game),
    title: translate("mcpAskTitle", { action: what }),
    text: reason ? translate("mcpAskReason", { reason }) : translate("mcpAskNoReason"),
    confirmLabel: translate("mcpAllow"), cancelLabel: translate("mcpDeny"), kind,
  });
  asked = getNotice()?.id;
  const timeout = new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), ASK_TIMEOUT_MS); });
  const outcome = await Promise.race([answer, timeout]);
  clearTimeout(timer);
  if (outcome === "timeout") {
    hideNotice(asked);
    throw new ToolError("The player did not answer in Game Access. Ask them to allow it in the app's notice, then try again.");
  }
  if (!outcome) {
    void narrate(`IA: ${what} — no permitido`, { area: "AI" });
    throw new ToolError("The player did not allow this in Game Access.");
  }
  void narrate(`IA: ${what}${reason ? ` (${reason})` : ""}`, { area: "AI" });
}

/** Logs an action that needs no question (freeze, thaw, pause, play). */
export function logAction(text: string): void { void narrate(`IA: ${text}`, { area: "AI" }); }
