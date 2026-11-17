/**
 * The player's plan (BASE or PLUS) and, for testing, the payment that turns it on (US.2, apps/api/app/payments.py).
 * `plan_status` is what the Game Access › Subscription page shows. `plan_simulate_payment` (developer tool) reports a
 * payment to a LOCAL test server as Patreon or Mercado Pago would, so the whole flow (an account is created for the
 * payer, PLUS is extended, a key is issued, the app turns PLUS) can be tried without paying. It refuses any server that
 * is not on this PC: the real ones only hear their providers.
 */
import { getActivationTier } from "../activation";
import { getAccount, refreshAccount } from "../account";
import { getApiBaseUrl } from "../settings";
import { bool, str, ToolError, type McpTool } from "./tools";

/** The admin token of the local test server (apps/api/run_demo_users_api.ps1); it opens nothing but that SQLite file. */
const LOCAL_TEST_ADMIN_TOKEN = "demo-users-local-admin-token-000";
const isLocal = (api: string) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(api);

function status() {
  const account = getAccount();
  return {
    plan: getActivationTier() === "plus" ? "PLUS" : "BASE",
    signed_in: Boolean(account),
    account: account ? { name: account.name, plus_active: account.plus_active, plus_until: account.plus_until } : null,
    say: account
      ? account.plus_active ? "Signed in, and the account's PLUS runs until plus_until." : "Signed in, but the account has no PLUS running."
      : "Not signed in: the player can sign in or register on Game Access › Subscription › My account.",
  };
}

export const planTools: McpTool[] = [
  {
    name: "plan_status",
    title: "The player's plan",
    description: "The plan this PC runs (BASE or PLUS) and, if the player is signed in to a Game Access account, whether that account's PLUS is running and until when. `refresh` asks the server first. Never signs in: the player does that on screen.",
    inputSchema: { type: "object", properties: { refresh: { type: "boolean", description: "Ask the server for the account's current state first." } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async args => {
      if (bool(args, "refresh")) await refreshAccount();
      return status();
    },
  },
  {
    name: "plan_simulate_payment", title: "Simulate a payment (test server)", developer: true,
    description: "Reports a payment to the LOCAL test server as a provider would: the payer's account is created if it does not exist, a `paid` event extends PLUS by a month and issues the account's key (returned once), `failed` and `canceled` extend nothing. Refuses a server that is not on this PC. Then plan_status with refresh shows it for the signed-in account.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["email"],
      properties: {
        email: { type: "string", description: "The payer's email: the account is found or created by it." },
        kind: { type: "string", enum: ["paid", "failed", "canceled"], description: "Default: paid." },
        provider: { type: "string", enum: ["patreon", "mercadopago", "manual"], description: "Default: manual." },
        name: { type: "string", description: "Name for a new account." },
        event_id: { type: "string", description: "Repeating the same id is ignored, as a provider's repeated notice would be." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async args => {
      const api = await getApiBaseUrl();
      if (!api || !isLocal(api)) throw new ToolError("This tool only talks to a test server on this PC (Settings › Server, e.g. http://127.0.0.1:38147). The real server only hears Patreon and Mercado Pago.");
      const email = str(args, "email");
      if (!email) throw new ToolError('"email" is required');
      const response = await fetch(`${api}/admin/payments/simulate`, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json", "X-GameAccess-Admin-Token": LOCAL_TEST_ADMIN_TOKEN },
        body: JSON.stringify({ email, kind: str(args, "kind") ?? "paid", provider: str(args, "provider") ?? "manual", name: str(args, "name"), event_id: str(args, "event_id") }),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new ToolError(`The test server refused it (${response.status}): ${String(body.detail ?? "unknown")}`);
      return body;
    },
  },
];
