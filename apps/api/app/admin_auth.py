"""Shared administration authentication: automatic loopback access or one remote session."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib.parse import urlsplit
from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

COOKIE = "gameaccess_admin_session"
SESSION_SECONDS = 12 * 60 * 60

def local_admin_request(request):
    hosts = {"127.0.0.1", "::1", "localhost"}
    client = request.client.host if request.client else ""
    origin = request.headers.get("Origin")
    try:
        local_origin = not origin or urlsplit(origin).hostname in hosts
    except ValueError:
        local_origin = False
    forwarded = any(name in request.headers for name in ("Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Real-IP"))
    return client in {"127.0.0.1", "::1"} and request.url.hostname in hosts and local_origin and not forwarded

def session_cookie(secret):
    payload = str(int(time.time()) + SESSION_SECONDS) + "." + secrets.token_urlsafe(24)
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return payload + "." + signature

def admin_authenticated(request):
    if local_admin_request(request):
        return True
    secret = os.environ.get("GAMEACCESS_ADMIN_TOKEN", "")
    if len(secret) < 32:
        return False
    supplied = request.headers.get("X-GameAccess-Admin-Token", "")
    if supplied and secrets.compare_digest(supplied, secret):
        return True
    cookie = request.cookies.get(COOKIE, "")
    try:
        expires, nonce, signature = cookie.split(".")
        payload = expires + "." + nonce
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return int(expires) > time.time() and hmac.compare_digest(signature, expected)
    except (ValueError, TypeError):
        return False

LOGIN_HTML = """<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameAccess · Administración</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06090d;color:#eef4f8;font:15px system-ui}main{width:min(400px,80vw);padding:32px;border:1px solid #26313c;border-radius:16px;background:#0c1118}h1{font-size:26px}p{color:#9cabbc;line-height:1.5}label{display:block;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:12px;border:1px solid #34454b;border-radius:8px;font:inherit}input{background:#06090d;color:white}button{margin-top:18px;background:#65f0b2;color:#06150f;cursor:pointer}#error{color:#ffb5ab}</style>
<main><h1>Administración</h1><p>Ingresá una vez para acceder a todo el panel.</p><form id="login"><label for="token">Token de administración</label><input id="token" type="password" autocomplete="current-password" required autofocus><button>Ingresar</button><p id="error" role="alert"></p></form></main>
<script>document.getElementById('login').onsubmit=async e=>{e.preventDefault();const input=document.getElementById('token');try{const response=await fetch('/admin-session/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:input.value})});const body=await response.json();input.value='';if(!response.ok)throw new Error(body.detail||'No se pudo iniciar sesión.');location.assign('/admin-console/')}catch(error){document.getElementById('error').textContent=error.message}};</script></html>"""

def install_admin_auth(app):
    @app.middleware("http")
    async def protect_admin_site(request, call_next):
        path = request.url.path
        protected = path == "/admin" or path.startswith("/admin/") or path == "/admin-console" or path.startswith("/admin-console/")
        if protected:
            if not admin_authenticated(request):
                pages = {"/admin", "/admin/", "/admin-console", "/admin-console/", "/admin/digital", "/admin/digital/", "/admin-console/digital", "/admin-console/digital/"}
                if request.method == "GET" and (path in pages or path.endswith("/view")):
                    return RedirectResponse("/admin-session/login", status_code=303)
                return JSONResponse({"detail": "Iniciá sesión en el panel de administración."}, status_code=401)
            origin = request.headers.get("Origin")
            if not local_admin_request(request) and origin and request.method not in {"GET", "HEAD", "OPTIONS"}:
                if urlsplit(origin).netloc != request.url.netloc:
                    return JSONResponse({"detail": "Origen de administración inválido."}, status_code=403)
        return await call_next(request)

    @app.get("/admin-session/login", include_in_schema=False)
    async def login_page(request: Request):
        if admin_authenticated(request):
            return RedirectResponse("/admin-console/", status_code=303)
        return HTMLResponse(LOGIN_HTML, headers={"Cache-Control": "no-store"})

    @app.post("/admin-session/login", include_in_schema=False)
    async def login(request: Request):
        secret = os.environ.get("GAMEACCESS_ADMIN_TOKEN", "")
        if len(secret) < 32:
            return JSONResponse({"detail": "El servidor no tiene configurado el acceso administrativo."}, status_code=503)
        try:
            supplied = (await request.json()).get("token", "")
        except (ValueError, AttributeError):
            supplied = ""
        if not isinstance(supplied, str) or not secrets.compare_digest(supplied, secret):
            return JSONResponse({"detail": "Token de administración incorrecto."}, status_code=401)
        response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
        response.set_cookie(COOKIE, session_cookie(secret), max_age=SESSION_SECONDS, httponly=True, secure=request.url.scheme == "https", samesite="strict")
        return response

    @app.post("/admin-session/logout", include_in_schema=False)
    async def logout():
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE)
        return response
