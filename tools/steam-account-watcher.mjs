import SteamUser from "steam-user";

const accountName = (process.env.STEAM_ACCOUNT_NAME || "").trim();
const password = process.env.STEAM_PASSWORD || "";
const durationMinutes = Math.max(1, Math.min(60, Number(process.env.WATCH_MINUTES || 15)));

if (!accountName || !password) {
  console.error("CONFIG_ERROR: STEAM_ACCOUNT_NAME and STEAM_PASSWORD must be provided as secrets");
  process.exit(2);
}

const client = new SteamUser({
  autoRelogin: true,
  promptSteamGuardCode: false,
});

let finished = false;
let lastState = null;

function safeState(blocked, playingApp) {
  const appid = Number(playingApp || 0);
  return { blocked: Boolean(blocked), playingApp: Number.isFinite(appid) ? appid : 0 };
}

function emit(kind, state = null, extra = {}) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    kind,
    ...(state || {}),
    ...extra,
  }));
}

function finish(code, reason) {
  if (finished) return;
  finished = true;
  emit("finished", lastState, { reason });
  try { client.logOff(); } catch {}
  setTimeout(() => process.exit(code), 500).unref();
}

client.on("loggedOn", () => {
  emit("logged_on");
  const current = client.playingState || {};
  lastState = safeState(current.blocked, current.appid ?? current.playingApp);
  emit("playing_state_initial", lastState);
});

client.on("playingState", (blocked, playingApp) => {
  lastState = safeState(blocked, playingApp);
  emit("playing_state_changed", lastState);
});

client.on("steamGuard", (domain, callback) => {
  emit("steam_guard_required", null, { method: domain ? "email" : "app" });
  callback("");
  finish(3, "steam_guard_required");
});

client.on("error", (error) => {
  emit("steam_error", lastState, {
    eresult: error?.eresult ?? null,
    message: error?.message || String(error),
  });
  if (!client.steamID) finish(4, "login_or_connection_error");
});

client.on("disconnected", (eresult, msg) => {
  emit("disconnected", lastState, { eresult: eresult ?? null, message: msg || null });
});

process.on("SIGTERM", () => finish(0, "sigterm"));
process.on("SIGINT", () => finish(0, "sigint"));

emit("watch_start", null, { durationMinutes });
client.logOn({ accountName, password, rememberPassword: true });
setTimeout(() => finish(0, "watch_complete"), durationMinutes * 60_000);
