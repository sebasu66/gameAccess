"""Download package sizes belong to the selected JSON source, never Steam storage."""
import math
import re


def size_bytes(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*", value, re.I)
    if not match:
        return None
    amount = float(match[1].replace(",", "."))
    unit = match[2].upper().replace("IB", "B")
    return round(amount * 1024 ** ["B", "KB", "MB", "GB", "TB"].index(unit)) if math.isfinite(amount) else None


def annotate_download_sizes(items, source_downloads):
    # Exact URI matching prevents a similarly named game's different release
    # or another provider's package size from leaking into this game.
    by_uri = {str(item.get("uri", "")).strip(): item for item in source_downloads if item.get("uri")}
    result = []
    for item in items:
        enriched = dict(item)
        source = by_uri.get(str(item.get("downloadSource", "")).strip(), item)
        label = source.get("file_size") or source.get("fileSize") or source.get("size") or source.get("download_size")
        label = str(label).strip() if label is not None else ""
        if label.casefold() in {"", "estándar", "standard", "unknown", "n/a"}:
            label = None
        enriched["download_size"] = label
        enriched["download_size_bytes"] = size_bytes(label)
        enriched["download_size_source"] = source.get("source_url") if label else None
        result.append(enriched)
    return result
