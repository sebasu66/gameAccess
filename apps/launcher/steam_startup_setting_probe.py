"""List Steam VDF key paths related to login/startup chooser without values."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from steam_pool import _read_vdf, steam_root

WORDS = ("startup", "chooser", "account", "login", "autologin", "userchooser", "remember")


def walk(node: Any, prefix: tuple[str, ...] = ()) -> list[str]:
    out: list[str] = []
    if not isinstance(node, dict):
        return out
    for key, value in node.items():
        text = str(key)
        path = prefix + (text,)
        folded = text.casefold()
        if any(word in folded for word in WORDS):
            out.append("/".join(path))
        out.extend(walk(value, path))
    return out


def main() -> int:
    root = steam_root()
    if not root:
        print(json.dumps({"ok": False, "error": "Steam root not found"}))
        return 1
    paths = []
    for rel in (Path("config/config.vdf"), Path("config/loginusers.vdf")):
        path = root / rel
        if not path.is_file():
            continue
        try:
            parsed = _read_vdf(path)
            paths.append({"file": str(rel), "key_paths": walk(parsed)})
        except Exception as exc:
            paths.append({"file": str(rel), "error": str(exc)})
    print(json.dumps({"ok": True, "files": paths}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
