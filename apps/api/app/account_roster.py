from __future__ import annotations

import csv
import os
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SteamCredential:
    label: str
    login: str
    password: str


_CREDENTIALS_BY_LABEL: dict[str, SteamCredential] = {}


def configured_accounts_path() -> Path:
    configured = os.environ.get("GAMEACCESS_ACCOUNTS_FILE", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[3] / "accFull.csv"


def _unwrap(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"`", "'"}:
        return value[1:-1]
    return value


def load_account_roster(path: Path | None = None) -> list[SteamCredential]:
    source = path or configured_accounts_path()
    if not source.is_file():
        return []

    seen_pairs: set[tuple[str, str]] = set()
    login_counts: defaultdict[str, int] = defaultdict(int)
    records: list[SteamCredential] = []
    with source.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if not row or all(not str(cell).strip() for cell in row):
                continue
            if len(row) < 2:
                continue
            login = str(row[0]).strip()
            password = str(row[1]).strip()
            if not login and not password:
                continue
            if login.casefold() in {"usr", "user", "username", "login"} and password.casefold() in {"pass", "password"}:
                continue
            pair = (login, password)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            login_counts[login] += 1
            occurrence = login_counts[login]
            label = login if occurrence == 1 else f"{login}#{occurrence}"
            records.append(SteamCredential(label=label, login=login, password=password))
    return records


def replace_runtime_roster(records: list[SteamCredential]) -> None:
    _CREDENTIALS_BY_LABEL.clear()
    _CREDENTIALS_BY_LABEL.update({record.label: record for record in records})


def credential_for_label(label: str) -> SteamCredential | None:
    return _CREDENTIALS_BY_LABEL.get(label)


def runtime_roster_count() -> int:
    return len(_CREDENTIALS_BY_LABEL)
