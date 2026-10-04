from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def rep(path, old, new):
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"anchor missing: {path} :: {old[:80]}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


routes = ROOT / "apps/api/app/provider_app_routes.py"
text = routes.read_text(encoding="utf-8")
if '"/admin-console/tools/provider-scan/retry"' not in text:
    text += '''\n\n@core.app.post("/admin-console/tools/provider-scan/retry")\ndef retry_provider_scan(req: dict[str, Any]) -> dict:\n    provider_id = str(req.get("provider_id") or "").strip()\n    if not provider_id:\n        raise HTTPException(400, "provider_id is required")\n    from . import admin_console_routes as admin\n\n    script = admin.LAUNCHER_ROOT / "provider_account_onboard.py"\n    if not script.is_file():\n        raise HTTPException(500, "provider_account_onboard.py not found")\n    try:\n        task = admin.start_task(\n            "provider_account_retry",\n            f"Reintentar scan Steam {provider_id}",\n            [\n                str(admin.launcher_python()),\n                str(script),\n                "--api",\n                "http://127.0.0.1:38147",\n                "--provider-id",\n                provider_id,\n                "--compact",\n            ],\n        )\n    except Exception as exc:\n        raise HTTPException(500, f"No se pudo iniciar el retry de SteamKit: {exc}") from exc\n    return {"ok": True, "task": task, "provider_id": provider_id}\n'''
    routes.write_text(text, encoding="utf-8")

html = ROOT / "apps/api/admin/index.html"
rep(
    html,
    '.toast{position:fixed;right:22px;bottom:22px;max-width:420px;padding:13px 15px;border:1px solid rgba(101,240,178,.2);border-radius:12px;background:#101721;box-shadow:0 20px 60px rgba(0,0,0,.45);font-size:12px;z-index:20}.offline{color:var(--red)}',
    '.toast{position:fixed;right:22px;bottom:22px;max-width:420px;padding:13px 15px;border:1px solid rgba(101,240,178,.2);border-radius:12px;background:#101721;box-shadow:0 20px 60px rgba(0,0,0,.45);font-size:12px;z-index:20}.offline{color:var(--red)}.dialog-backdrop{position:fixed;inset:0;display:none;place-items:center;padding:24px;background:rgba(0,0,0,.68);z-index:50}.dialog{width:min(720px,100%);max-height:82vh;overflow:auto;border:1px solid var(--line);border-radius:16px;background:#0c1118;box-shadow:0 30px 100px rgba(0,0,0,.65);padding:18px}.dialog h3{margin:0 0 8px}.dialog p{color:#aab6c4;white-space:pre-line}.dialog pre{max-height:320px;overflow:auto;padding:11px;border-radius:10px;background:#05080c;color:#aab6c4;font:11px/1.5 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap}',
)
rep(
    html,
    '<div id="toast"></div>\n<script>',
    '<div id="toast"></div>\n<div id="operationDialog" class="dialog-backdrop" onclick="if(event.target===this)closeOperationDialog()"><div class="dialog"><h3 id="operationDialogTitle">Steam</h3><p id="operationDialogMessage"></p><pre id="operationDialogDetail"></pre><div style="display:flex;justify-content:flex-end"><button class="btn primary" onclick="closeOperationDialog()">Cerrar</button></div></div></div>\n<script>',
)
rep(
    html,
    "  async function api(path,opts={})",
    '''  function closeOperationDialog(){$('operationDialog').style.display='none'}\n  function taskPayload(task){for(const line of String(task?.log||'').trim().split(/\\r?\\n/).reverse()){try{const value=JSON.parse(line.trim());if(value&&typeof value==='object')return value}catch{}}return null}\n  function showOperationDialog(title,message,task){const payload=taskPayload(task);$('operationDialogTitle').textContent=title;$('operationDialogMessage').textContent=message;$('operationDialogDetail').textContent=payload?JSON.stringify(payload,null,2):String(task?.log||'Sin detalle devuelto por Steam.');$('operationDialog').style.display='grid'}\n  function taskFailure(task,payload){const parts=[];const status=payload?.scan_status||payload?.status||task?.state;if(status)parts.push(`Steam: ${status}`);if(payload?.error)parts.push(String(payload.error));if(payload?.guard_method)parts.push(`Steam Guard: ${payload.guard_method}`);if(Array.isArray(payload?.attempts))parts.push('Intentos: '+payload.attempts.map(x=>`${x.mode||'login'}=${x.status||'unknown'}`).join(' · '));return parts.join('\\n')||`La operación terminó con código ${task?.exit_code??'desconocido'}.`}\n  async function waitForTask(id,title,success){const until=Date.now()+240000;while(Date.now()<until){try{const tasks=await api('/tasks');const task=(tasks||[]).find(x=>x.id===id);if(!task||task.status==='running'){await new Promise(r=>setTimeout(r,1000));continue}const payload=taskPayload(task);await refresh();if(task.status==='error'||payload?.ok===false)showOperationDialog(title+' · error',taskFailure(task,payload),task);else toast(success);return}catch(err){showOperationDialog(title+' · error',err.message,{log:''});return}}showOperationDialog(title+' · timeout','La operación no terminó dentro de 4 minutos.',{log:''})}\n\n  async function api(path,opts={})''',
)
rep(
    html,
    '''<button class="btn primary" style="padding:6px 9px" onclick="loginProviderSteam('${esc(a.identity?.account_name||a.label)}')">Login</button>''',
    '''<button class="btn primary" style="padding:6px 9px" onclick="loginProviderSteam('${esc(a.identity?.account_name||a.label)}')">Login</button> <button class="btn" style="padding:6px 9px" onclick="retryProviderScan('${esc(a.identity?.account_name||a.label)}')">Retry</button>''',
)
rep(
    html,
    "  async function loginProviderSteam(providerId){try{await api('/tools/provider-login/start',{method:'POST',body:JSON.stringify({provider_id:providerId})});toast(`Login de Steam iniciado para ${providerId}`);await refresh()}catch(err){toast(err.message,true)}}",
    "  async function loginProviderSteam(providerId){try{const r=await api('/tools/provider-login/start',{method:'POST',body:JSON.stringify({provider_id:providerId})});toast(`Login de Steam iniciado para ${providerId}`);void waitForTask(r.task.id,`Login Steam · ${providerId}`,`Login Steam correcto para ${providerId}`);await refresh()}catch(err){showOperationDialog(`Login Steam · ${providerId}`,err.message,{log:''})}}\n  async function retryProviderScan(providerId){try{const r=await api('/tools/provider-scan/retry',{method:'POST',body:JSON.stringify({provider_id:providerId})});toast(`Retry de SteamKit iniciado para ${providerId}`);void waitForTask(r.task.id,`Scan SteamKit · ${providerId}`,`Scan actualizado para ${providerId}`);await refresh()}catch(err){showOperationDialog(`Scan SteamKit · ${providerId}`,err.message,{log:''})}}",
)

print("patched admin Retry + Steam error dialog")
