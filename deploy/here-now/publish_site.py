"""Publish deploy/website to here.now (https://here.now/docs): create or update the site, upload, finalize.

The API key comes from HERENOW_API_KEY (a Windows user variable on Seba's PC); with it the site is permanent.
The site's slug is kept in site.json next to this script, so the next run updates the same address.

    python -I deploy/here-now/publish_site.py
"""
from __future__ import annotations
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://here.now/api/v1/publish"
HERE = Path(__file__).resolve().parent
SITE = HERE.parent / "website"
STATE = HERE / "site.json"
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".txt": "text/plain; charset=utf-8", ".webm": "video/webm", ".png": "image/png", ".ttf": "font/ttf", ".json": "application/json"}


def call(method: str, url: str, key: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {key}", "X-HereNow-Client": "claude-code/gameaccess-site", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        sys.exit(f"{method} {url} -> {error.code}: {error.read().decode(errors='replace')[:500]}")


def upload(url: str, path: Path, content_type: str, headers: dict | None = None) -> None:
    request = urllib.request.Request(url, data=path.read_bytes(), method="PUT", headers={"content-type": content_type, **(headers or {})})
    with urllib.request.urlopen(request, timeout=300) as response:
        if response.status >= 300:
            sys.exit(f"upload of {path} -> {response.status}")


def main() -> None:
    key = os.environ.get("HERENOW_API_KEY", "").strip()
    if not key:
        sys.exit("Falta HERENOW_API_KEY.")
    files = sorted(p for p in SITE.rglob("*") if p.is_file())
    listing = {p.relative_to(SITE).as_posix(): p for p in files}
    manifest = {"files": [{"path": name, "size": p.stat().st_size,
                           "contentType": TYPES.get(p.suffix.lower()) or mimetypes.guess_type(p.name)[0] or "application/octet-stream"}
                          for name, p in listing.items()]}
    slug = json.loads(STATE.read_text(encoding="utf-8")).get("slug") if STATE.is_file() else None
    created = call("PUT", f"{API}/{slug}", key, manifest) if slug else call("POST", API, key, manifest)
    slug = created.get("slug") or slug
    plan = created.get("upload") or {}
    types = {f["path"]: f["contentType"] for f in manifest["files"]}
    for item in plan.get("uploads", []):
        upload(item["url"], listing[item["path"]], types[item["path"]], item.get("headers"))
        print("subido", item["path"])
    done = call("POST", f"{API}/{slug}/finalize", key, {"versionId": plan.get("versionId")})
    STATE.write_text(json.dumps({"slug": slug, "siteUrl": done.get("siteUrl") or created.get("siteUrl")}, indent=2) + "\n", encoding="utf-8")
    print("listo:", done.get("siteUrl") or created.get("siteUrl"))


if __name__ == "__main__":
    main()
