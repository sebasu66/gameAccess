import { ACTIVATION_CHANGED_EVENT, getActivationTier, getInstallationId } from "./activation";
import { narrate } from "./narrationLog";
import { getApiBaseUrl } from "./settings";

/** The player's own account (vault/Tareas.md L3): optional, BASE needs none; it keeps the PLUS key in the player's name. */
export type Account = { name: string; email: string; language: string; plus_active: boolean; plus_until: string | null };
export type AccountResult = "ok" | "offline" | "too_many" | "invalid_email" | "invalid_password" | "invalid_name" | "email_taken" | "bad_credentials" | "failed";

export const ACCOUNT_CHANGED_EVENT = "gameaccess:account-changed";
// The session stays on this PC until the player signs out (L3: "la sesión se recuerda en la PC").
const STORE = "gameaccess:account";
type Saved = { token: string; account: Account };

function saved(): Saved | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) || "null") as Saved | null;
    return value?.token && value.account ? value : null;
  } catch {
    return null;
  }
}

function save(value: Saved | null): void {
  try {
    if (value) localStorage.setItem(STORE, JSON.stringify(value));
    else localStorage.removeItem(STORE);
  } catch { /* storage may be blocked; the session then lasts until the app closes */ }
  cached = value;
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
}

let cached: Saved | null | undefined;
export function getAccount(): Account | null {
  if (cached === undefined) cached = saved();
  return cached?.account ?? null;
}

const KNOWN = new Set<AccountResult>(["invalid_email", "invalid_password", "invalid_name", "email_taken", "bad_credentials"]);

async function call(path: string, init: { method?: string; body?: unknown; token?: string }, fetcher: typeof fetch): Promise<{ result: AccountResult; body?: Record<string, unknown> }> {
  try {
    const [api, installationId] = await Promise.all([getApiBaseUrl(), getInstallationId()]);
    if (!api || !installationId) return { result: "offline" };
    const response = await fetcher(`${api}${path}`, {
      method: init.method ?? "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "X-GameAccess-Installation": installationId, ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { result: "ok", body };
    if (response.status === 429) return { result: "too_many" };
    const detail = String(body.detail ?? "") as AccountResult;
    return { result: KNOWN.has(detail) ? detail : "failed", body };
  } catch (error) {
    void narrate(`Account request ${path} could not reach the server: ${error instanceof Error ? error.message : String(error)}.`, { area: "ACCOUNT", level: "WARN" });
    return { result: "offline" };
  }
}

async function signIn(path: string, body: unknown, fetcher: typeof fetch): Promise<AccountResult> {
  const { result, body: reply } = await call(path, { body }, fetcher);
  if (result === "ok" && typeof reply?.token === "string") save({ token: reply.token, account: reply.account as Account });
  void narrate(`Account ${path.endsWith("register") ? "registration" : "sign-in"}: ${result}.`, { area: "ACCOUNT" });
  return result;
}

export const registerAccount = (form: { name: string; email: string; password: string; language: string }, fetcher: typeof fetch = fetch) =>
  signIn("/accounts/register", { name: form.name.trim(), email: form.email.trim(), password: form.password, language: form.language }, fetcher);

export const signInAccount = (form: { email: string; password: string }, fetcher: typeof fetch = fetch) =>
  signIn("/accounts/login", { email: form.email.trim(), password: form.password }, fetcher);

/** Signs out on this PC; the server forgets the session too when it can be reached. */
export async function signOutAccount(fetcher: typeof fetch = fetch): Promise<void> {
  const token = saved()?.token;
  save(null);
  if (token) await call("/accounts/logout", { token }, fetcher);
}

/** Brings the account's PLUS state up to date; a session the server no longer knows is forgotten here. */
export async function refreshAccount(fetcher: typeof fetch = fetch): Promise<void> {
  const current = saved();
  if (!current) return;
  const { result, body } = await call("/accounts/me", { method: "GET", token: current.token }, fetcher);
  if (result === "ok" && body) save({ token: current.token, account: body as unknown as Account });
  else if (result === "failed" && body?.detail === "signed_out") save(null);
}

/** A PLUS key activated while signed in is tied to the account. */
export async function linkInstallation(fetcher: typeof fetch = fetch): Promise<void> {
  const current = saved();
  if (!current) return;
  const { result, body } = await call("/accounts/link-installation", { token: current.token }, fetcher);
  if (result === "ok" && body?.account) save({ token: current.token, account: body.account as Account });
}

if (typeof window !== "undefined") {
  // The event comes with every access check: tie the key once, when this PC turns PLUS.
  let wasPlus = false;
  window.addEventListener(ACTIVATION_CHANGED_EVENT, () => {
    const plus = getActivationTier() === "plus";
    if (plus && !wasPlus && saved()) void linkInstallation();
    wasPlus = plus;
  });
}
