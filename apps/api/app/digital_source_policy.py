"""Resolve source-level Digital policies for the actual selected download URI."""
from __future__ import annotations

def annotate_source_policies(items):
    from .digital_admin_routes import load_sources_config, load_cached_downloads
    sources = sorted(load_sources_config().get("sources", []), key=lambda s: s.get("priority", 999))
    by_url = {s.get("url"): s for s in sources}
    by_label = {s.get("label"): s for s in sources}
    by_uri = {}
    for package in load_cached_downloads():
        source = by_url.get(package.get("source_url")) or by_label.get(package.get("source"))
        if source and package.get("uri"):
            existing = by_uri.get(package["uri"])
            if not existing or source.get("priority", 999) < existing.get("priority", 999):
                by_uri[package["uri"]] = source
    result = []
    for item in items:
        uri = item.get("downloadSource") or item.get("uri") or ""
        source = by_url.get(item.get("source_url")) or by_uri.get(uri)
        result.append({**item, "auto_installed": bool(source and source.get("auto_installed", False)),
                       "source_url": source.get("url", "") if source else item.get("source_url", "")})
    return result
