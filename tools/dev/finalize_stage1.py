from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Anchor not found in {path}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


replace_once(
    "apps/desktop/src-tauri/src/native_core.rs",
    """accounts=[]
for a in p.get('accounts',[]):
 accounts.append({'label':a.get('display_name') or a.get('account_name') or 'Steam','account_name':a.get('account_name') or '','steam_id64':a.get('steam_id64') or '','user_id32':a.get('user_id32'),'app_ids':[x for x in (a.get('app_ids') or []) if x in valid],'accessible_app_ids':[x for x in (a.get('accessible_app_ids') or []) if x in valid],'active':bool(a.get('active'))})
out={'source':'steam-local-remembered-accounts','verification_complete':bool(p.get('ok')),'verified_at':None,'accounts':accounts,'games':sorted(games,key=lambda g:g['app_id']),'library_folders':[]}; print(json.dumps(out,ensure_ascii=False))""",
    """accounts=[]
for a in p.get('accounts',[]):
 accounts.append({'label':a.get('display_name') or a.get('account_name') or 'Steam','account_name':a.get('account_name') or '','steam_id64':a.get('steam_id64') or '','user_id32':a.get('user_id32'),'app_ids':[x for x in (a.get('app_ids') or []) if x in valid],'accessible_app_ids':[x for x in (a.get('accessible_app_ids') or []) if x in valid],'ticketed_app_count':int(a.get('ticketed_app_count') or 0),'ownership_source':a.get('ownership_source') or 'unverified','ownership_verified':bool(a.get('ownership_verified')),'ownership_verified_at':a.get('ownership_verified_at'),'active':bool(a.get('active'))})
out={'source':p.get('ownership_source') or 'none','verification_complete':bool(p.get('ownership_complete')),'verified_at':p.get('ownership_verified_at'),'ownership_error':p.get('ownership_error'),'verified_account_count':int(p.get('verified_account_count') or 0),'accounts':accounts,'games':sorted(games,key=lambda g:g['app_id']),'library_folders':[]}; print(json.dumps(out,ensure_ascii=False))""",
)

replace_once(
    "apps/desktop/src/native.ts",
    """export interface LocalSteamAccount {
  label: string;
  account_name: string;
  steam_id64?: string;
  user_id32?: number | null;
  app_ids: number[];
  accessible_app_ids: number[];
  active: boolean;
}

export interface LocalSteamPool {
  source: string;
  verification_complete: boolean;
  verified_at: string | null;
  accounts: LocalSteamAccount[];
""",
    """export interface LocalSteamAccount {
  label: string;
  account_name: string;
  steam_id64?: string;
  user_id32?: number | null;
  app_ids: number[];
  accessible_app_ids: number[];
  ticketed_app_count?: number;
  ownership_source?: string;
  ownership_verified?: boolean;
  ownership_verified_at?: string | null;
  active: boolean;
}

export interface LocalSteamPool {
  source: string;
  verification_complete: boolean;
  verified_at: string | null;
  ownership_error?: string | null;
  verified_account_count?: number;
  accounts: LocalSteamAccount[];
""",
)

replace_once(
    "apps/desktop/src/api.ts",
    """  await narrate(
    `The local Steam scan found ${pool.accounts.length} remembered account(s) and ${pool.games.length} Windows game record(s). Scanner verification_complete=${pool.verification_complete}.`,
    { area: "LOCAL STEAM" },
  );
  await narrateBatch(
    pool.accounts.map((account) => {
      const label = account.account_name || account.label || "unnamed Steam account";
      return `${label}: ${account.active ? "currently active" : "remembered but not active"}; app_ids ownership candidates=${account.app_ids.length}; accessible_app_ids visibility/access entries=${account.accessible_app_ids.length}. These two lists are intentionally not treated as the same thing.`;
    }),
    { area: "LOCAL STEAM" },
  );
""",
    """  await narrate(
    `The local Steam scan found ${pool.accounts.length} remembered account(s) and ${pool.games.length} Windows game record(s). Verified ownership source='${pool.source}', verification_complete=${pool.verification_complete}, verified_at=${pool.verified_at ?? "unknown"}, verified_accounts=${pool.verified_account_count ?? 0}/${pool.accounts.length}.`,
    { area: "LOCAL STEAM" },
  );
  if (pool.ownership_error) {
    await narrate(
      `Ownership verification note: ${pool.ownership_error}. The scanner fails closed: unverified accounts can contribute visible games but cannot make them playable.`,
      { area: "LOCAL STEAM", level: "WARN" },
    );
  }
  await narrateBatch(
    pool.accounts.map((account) => {
      const label = account.account_name || account.label || "unnamed Steam account";
      const verified = account.ownership_verified
        ? `VERIFIED ownership from ${account.ownership_source ?? pool.source}: ${account.app_ids.length} owned game(s)`
        : "ownership NOT verified: 0 playable owned games";
      return `${label}: ${account.active ? "currently active" : "remembered but not active"}; ${verified}; accessible_app_ids visibility/access entries=${account.accessible_app_ids.length}; local ticket entries=${account.ticketed_app_count ?? 0} (diagnostic only, never a license).`;
    }),
    { area: "LOCAL STEAM" },
  );
""",
)

replace_once(
    "apps/desktop/src/App.tsx",
    """      {offlineDemo ? <div className="system-banner demo"><Sparkles size={15} /> Modo offline: mostrando el catálogo combinado de las cuentas Steam detectadas en esta PC.</div> : null}
""",
    """      {offlineDemo ? <div className="system-banner demo"><Sparkles size={15} /> No se pudo comunicar con el servidor de GameAccess. La biblioteca local y Store siguen disponibles; el catálogo de GameAccess volverá cuando haya conexión.</div> : null}
""",
)

print("Stage 1 ownership/backend diagnostics patch applied.")
