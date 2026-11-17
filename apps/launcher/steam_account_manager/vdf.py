"""Reader for Steam's text KeyValues files (`.vdf`, `.acf`): loginusers, libraryfolders, localconfig, appmanifest.

Steam is not consistent with key case ("apps" / "Apps"), so `child` looks keys up without case. Values are always
strings; a repeated key keeps the last value, as Steam does. Conditionals (`[$WIN32]`) and `//` comments are skipped."""
from __future__ import annotations
from pathlib import Path

ESCAPES = {"n": "\n", "t": "\t", "\\": "\\", '"': '"'}


def _tokens(text: str):
    i, size = 0, len(text)
    while i < size:
        char = text[i]
        if char.isspace():
            i += 1
        elif text.startswith("//", i):
            end = text.find("\n", i)
            i = size if end < 0 else end + 1
        elif char in "{}":
            yield char
            i += 1
        elif char == "[":
            end = text.find("]", i)
            i = size if end < 0 else end + 1
        elif char == '"':
            i += 1
            out = []
            while i < size and text[i] != '"':
                if text[i] == "\\" and i + 1 < size:
                    out.append(ESCAPES.get(text[i + 1], "\\" + text[i + 1]))
                    i += 2
                else:
                    out.append(text[i])
                    i += 1
            i += 1
            yield ("s", "".join(out))
        else:
            start = i
            while i < size and not text[i].isspace() and text[i] not in '{}"':
                i += 1
            yield ("s", text[start:i])


def loads(text: str) -> dict:
    """The whole file as nested dicts: `{"AppState": {"appid": "10", ...}}`."""
    root: dict = {}
    stack = [root]
    key = None
    for token in _tokens(text.lstrip("﻿")):
        if token == "{":
            child_dict: dict = {}
            stack[-1][key if key is not None else ""] = child_dict
            stack.append(child_dict)
            key = None
        elif token == "}":
            if len(stack) > 1:
                stack.pop()
            key = None
        elif key is None:
            key = token[1]
        else:
            stack[-1][key] = token[1]
            key = None
    return root


def load(path: Path) -> dict:
    """An unreadable or missing file is an empty dict: Steam files come and go while Steam runs."""
    try:
        return loads(Path(path).read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return {}


def child(node, *keys: str):
    """`child(data, "UserLocalConfigStore", "Software", "Valve", "Steam", "apps")`, ignoring key case; None when missing."""
    for key in keys:
        if not isinstance(node, dict):
            return None
        if key in node:
            node = node[key]
            continue
        lower = key.lower()
        node = next((value for name, value in node.items() if name.lower() == lower), None)
    return node
