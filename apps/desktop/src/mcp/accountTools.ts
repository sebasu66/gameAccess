/**
 * The player's account libraries (Library › Manager › Accounts, AccountLibraries.tsx): which Steam accounts are
 * linked, linking one more and removing one. Each linked account brings its whole library, synced on its own; games are
 * never added or removed one by one. Linking opens Steam's own sign-in page: the player signs in there, never the AI,
 * and Game Access never sees the password. Removing an account asks the player first.
 */
import { translate } from "../i18n";
import { linkSteamAccount, removeSteamAccount, steamStatus, syncSteamLibrary } from "../steamLibrary";
import type { CatalogGame } from "../types";
import { askPlayer, logAction } from "./confirm";
import { bool, str, ToolError, type McpTool } from "./tools";

/** The accounts as the AI sees them; `remembered` tells whether this PC's Steam can open it to play. */
async function accounts() {
  const status = await steamStatus();
  if (!status) throw new ToolError("Game Access could not read Steam's state on this PC.");
  return {
    steam_installed: status.found,
    accounts: status.accounts.map(account => ({
      store: "steam", account_id: account.steam_id64, name: account.persona_name || account.account_name || account.steam_id64,
      owned: account.owned_count, installed: account.installed_count, remembered_on_this_pc: account.remembered, open_in_steam: account.active,
      private_profile: account.private, error: account.error || null,
    })),
    // Accounts this PC's Steam remembers but the player has not linked: only to suggest, never linked by themselves.
    suggestions: (status.suggestions ?? []).map(suggestion => ({ store: "steam", name: suggestion.persona_name || suggestion.account_name })),
    synced_at: status.owned_fetched_at ? new Date(status.owned_fetched_at * 1000).toISOString() : null,
  };
}

let linking: Promise<unknown> | null = null;

export const accountTools: McpTool[] = [
  {
    name: "accounts_list",
    title: "The player's store accounts",
    description: "The store accounts linked to Game Access (Steam today; Epic, GOG and Xbox later) with how many games each owns and has installed, and the accounts this PC's Steam remembers that are not linked (suggestions). Each linked account's whole library is in the player's library (library_list, `library`). sync: read every account's library again first.",
    inputSchema: { type: "object", properties: { sync: { type: "boolean", description: "Sync the account libraries first (a few seconds)." } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async args => {
      if (!bool(args, "sync")) return accounts();
      const result = await syncSteamLibrary([], { refresh: true });
      return { ...(await accounts()), sync: { installed_linked: result.linked?.length ?? 0, owned_not_installed: result.owned?.length ?? 0, removed: result.removed ?? [] } };
    },
  },
  {
    name: "link_account",
    title: "Link a store account",
    description: "Opens Steam's own sign-in page in the player's browser to link one more Steam account; the player signs in there (never the AI, and Game Access never sees the password). It answers at once: ask the player to sign in, then check accounts_list. The page waits about 10 minutes.",
    inputSchema: { type: "object", properties: { store: { type: "string", enum: ["steam"], description: "Default: steam." } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async args => {
      if ((str(args, "store") ?? "steam") !== "steam") throw new ToolError("Only Steam accounts can be linked for now.");
      if (linking) return { started: false, waiting: true, say: "Steam's sign-in page is already open: the player signs in there." };
      linking = linkSteamAccount().finally(() => { linking = null; });
      logAction(translate("acctSteamLink"));
      return { started: true, say: "Steam's sign-in page opened in the player's browser: they sign in there with the account to link. Then accounts_list shows it." };
    },
  },
  {
    name: "remove_account",
    title: "Remove a linked account",
    description: "Removes a linked store account: its whole library leaves Game Access. Nothing is uninstalled and Steam is not touched; it can be linked again. The player is asked to allow it in the app. account_id comes from accounts_list.",
    inputSchema: { type: "object", properties: { account_id: { type: "string", description: "From accounts_list." }, reason: { type: "string", description: "Why, in a few words, for the player." } }, required: ["account_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: async args => {
      const id = str(args, "account_id") ?? "";
      const account = (await accounts()).accounts.find(entry => entry.account_id === id);
      if (!account) throw new ToolError(`No linked account has account_id ${id}. accounts_list shows them.`);
      await askPlayer({ id: 0, name: account.name } as CatalogGame, "mcpActRemoveAccount", str(args, "reason"));
      await removeSteamAccount(id);
      return { removed: true, name: account.name };
    },
  },
];
