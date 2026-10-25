"""Texts the app shows travel as keys of its translation catalogs (apps/desktop/src/locales), not as Spanish words.

A key goes inside the status or error text as ⟦key {"arg": 1}⟧ and the app swaps it for its own language
(apps/desktop/src/launcherText.ts), so one text can mix keys with plain parts such as a file name.
"""
import json


def ui(key: str, **args) -> str:
    # ensure_ascii keeps the closing ⟧ out of the arguments, so the app can find where each key ends.
    return f"⟦{key} {json.dumps(args)}⟧" if args else f"⟦{key}⟧"
