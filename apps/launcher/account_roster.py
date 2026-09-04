from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GameAccessAccount:
    account_name: str
    password: str


def _trim_cell(value: str) -> str:
    return value.strip(" \t\r\n`")


def load_gameaccess_accounts(path: str | Path) -> list[GameAccessAccount]:
    """Load the explicit Game Access provider roster.

    The source format is intentionally treated as opaque except for the two
    agreed columns: column 2 is the Steam account name and column 3 is the
    password. Outer whitespace/backticks are removed; everything inside each
    cell is preserved verbatim. The only deduplication is an exact
    (account_name, password) pair match.
    """
    source = Path(path)
    rows: list[GameAccessAccount] = []
    seen: set[tuple[str, str]] = set()

    for raw_line in source.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw_line.strip():
            continue
        cells = raw_line.split("|")
        account_name = _trim_cell(cells[2] if len(cells) > 2 else "")
        password = _trim_cell(cells[3] if len(cells) > 3 else "")
        key = (account_name, password)
        if key in seen:
            continue
        seen.add(key)
        rows.append(GameAccessAccount(account_name=account_name, password=password))

    return rows


def gameaccess_account_names(path: str | Path) -> list[str]:
    return [item.account_name for item in load_gameaccess_accounts(path)]
