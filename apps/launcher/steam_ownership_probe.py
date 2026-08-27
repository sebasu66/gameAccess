"""Probe Steam local metadata for an authoritative ownership signal.

This diagnostic intentionally emits only file/key paths and hit counts. It never
prints VDF/registry values, cookies, tokens, passwords, Steam Guard secrets or
auth blobs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from steam_pool import _read_vdf, steam_root

if __import__('os').name == 'nt':
    import winreg
else:  # pragma: no cover
    winreg = None


KEY_WORDS = ("license", "licenses", "family", "borrow", "owner", "package", "ticket")


def walk_key_paths(node: Any, prefix: tuple[str, ...] = ()) -> list[str]:
    out: list[str] = []
    if not isinstance(node, dict):
        return out
    for key, value in node.items():
        text = str(key)
        path = prefix + (text,)
        folded = text.casefold()
        if any(word in folded for word in KEY_WORDS):
            out.append("/".join(path))
        out.extend(walk_key_paths(value, path))
    return out


def text_hit_counts(path: Path, needles: list[str]) -> dict[str, int]:
    try:
        if path.stat().st_size > 8_000_000:
            return {}
        data = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return {}
    result = {}
    lower = data.casefold()
    for needle in needles:
        count = lower.count(needle.casefold())
        if count:
            result[needle] = count
    return result


def registry_key_paths() -> list[str]:
    if winreg is None:
        return []
    roots = [r"Software\Valve\Steam"]
    found: list[str] = []

    def visit(path: str, depth: int) -> None:
        if depth > 5:
            return
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
                index = 0
                while True:
                    try:
                        sub = winreg.EnumKey(key, index)
                    except OSError:
                        break
                    index += 1
                    child = path + "\\" + sub
                    folded = sub.casefold()
                    if any(word in folded for word in KEY_WORDS):
                        found.append(child)
                    visit(child, depth + 1)
                index = 0
                while True:
                    try:
                        name, _value, _kind = winreg.EnumValue(key, index)
                    except OSError:
                        break
                    index += 1
                    folded = str(name).casefold()
                    if any(word in folded for word in KEY_WORDS):
                        found.append(path + "::" + str(name))
        except OSError:
            return

    for root in roots:
        visit(root, 0)
    return sorted(set(found))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", type=int, required=True)
    parser.add_argument("--package-id", type=int)
    args = parser.parse_args()

    root = steam_root()
    if not root:
        print(json.dumps({"ok": False, "error": "Steam root not found"}))
        return 1

    needles = [str(args.app_id), "license", "family", "borrow", "owner", "package", "ticket"]
    if args.package_id:
        needles.append(str(args.package_id))

    candidates: list[Path] = []
    for base in (root / "userdata", root / "config"):
        if base.exists():
            for ext in ("*.vdf", "*.json"):
                candidates.extend(base.rglob(ext))

    files = []
    for path in sorted(set(candidates)):
        hits = text_hit_counts(path, needles)
        key_paths: list[str] = []
        if path.suffix.casefold() == ".vdf" and path.stat().st_size < 8_000_000:
            try:
                key_paths = walk_key_paths(_read_vdf(path))
            except Exception:
                pass
        if hits or key_paths:
            try:
                rel = str(path.relative_to(root))
            except Exception:
                rel = str(path)
            files.append({
                "file": rel,
                "hits": hits,
                "interesting_key_paths": key_paths[:120],
            })

    print(json.dumps({
        "ok": True,
        "steam_root": str(root),
        "app_id": args.app_id,
        "package_id": args.package_id,
        "files": files,
        "registry_key_paths": registry_key_paths(),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
