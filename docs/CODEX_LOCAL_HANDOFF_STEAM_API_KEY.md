# Codex local handoff — Steam Web API key and one-account ownership probe

## Goal

Complete locally on the Windows PC the step that the remote tool bridge cannot execute reliably: import the existing text value from `C:\Users\Lorita\Desktop\Steam.txt` into the user-scoped environment variable `STEAM_WEB_API_KEY`, then run a single-provider `IPlayerService/GetOwnedGames` probe and record only sanitized results.

## Mandatory preparation

Before changing or running anything:

1. Read `skill.md`, `docs/EXECUTION_PROTOCOL.md`, `README.md`, and the relevant Steam/provider code.
2. Inspect the current implementations in `apps/launcher/steam_web_inventory.py`, `apps/launcher/provider_roster.py`, `apps/launcher/steam_pool.py`, and `apps/launcher/pool_sync.py` instead of assuming their behavior.
3. Preserve the provider taxonomy: GameAccess/provider accounts come only from `C:\DEV\gameAccess\cuentas.txt`; remembered/local Steam accounts are a separate user-account source.
4. Do not print, log, commit, or echo the contents of `Steam.txt`, provider passwords, or `STEAM_WEB_API_KEY`.

## Task A — import the environment variable locally

Implement or use a small local helper in the GameAccess checkout that:

1. Reads `C:\Users\Lorita\Desktop\Steam.txt` as plain UTF-8 text.
2. Applies only `.strip()` to remove surrounding whitespace/newlines.
3. Fails if the resulting value is empty.
4. Persists the value as the current Windows user's `STEAM_WEB_API_KEY` using the user environment (`HKCU\Environment` / equivalent supported Windows API).
5. Broadcasts the normal Windows environment-change notification if appropriate.
6. Verifies persistence by reading the user-scoped environment value back in a fresh process.
7. Reports only: success/failure, variable name, scope, and value length. Never return the value itself.

Do not delete `Steam.txt` unless explicitly requested.

## Task B — run one provider ownership probe

After the environment variable is confirmed:

1. Load the provider roster only from `C:\DEV\gameAccess\cuentas.txt` using the existing roster parser.
2. Select exactly one provider account for this validation.
3. Resolve that provider to its existing local Steam identity / SteamID64 using the existing mapping code; do not log the provider login or password.
4. Call Valve's official `IPlayerService/GetOwnedGames/v1/` with the API key from `STEAM_WEB_API_KEY`, not from command-line arguments or source code.
5. Request app info and played free games as currently supported by the implementation.
6. Record only sanitized output: HTTP/result status, owned-game count, a small sample of AppIDs/game names, and whether the response was complete/empty/error.
7. Compare the owned AppIDs for this account with its existing `local_library_apps(user_id32)` accessible AppIDs and report counts for:
   - directly owned
   - locally accessible
   - accessible but not directly owned (candidate Family/shared access)

Do not infer Family ownership solely from the difference; label it only as a candidate until SteamKit `LicenseList` or another authoritative source confirms attribution.

## Task C — fix canonical provider inventory wiring if needed

If the probe works, inspect `pool_sync.py` and remove the remaining dependency on remembered/local Steam accounts for provider inventory. The canonical GameAccess provider path should be:

`cuentas.txt -> provider_roster -> steam_account_identities -> local_library_apps -> accessible_app_ids`

Ownership from `GetOwnedGames` is an optional authoritative layer for direct ownership and must not prevent the accessible catalog from being built.

Do not create additional `*_v2`, `*_v5`, etc. implementations. Consolidate into the existing canonical path.

## Acceptance criteria

- `STEAM_WEB_API_KEY` exists in the Windows user environment and is visible to a fresh process without exposing its value.
- No secret value is printed, committed, or added to command-line arguments.
- One provider account is queried successfully, or the exact Valve/API error is captured without exposing secrets.
- Sanitized owned/accessibility comparison is recorded.
- If provider inventory wiring is changed, tests covering provider-vs-remembered account separation pass.
- Leave a concise result note in `TODO.md` or the relevant project handoff with files/commit and measured counts/status.
