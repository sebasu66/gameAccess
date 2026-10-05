from __future__ import annotations

import csv
import os
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

    index_by_login: dict[str, int] = {}
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
            identity = login.casefold()
            credential = SteamCredential(label=login, login=login, password=password)
            if identity in index_by_login:
                # Same Steam login is one provider account. The latest row wins
                # so an updated password repairs the existing account instead of
                # creating a second logical seat.
                records[index_by_login[identity]] = credential
            else:
                index_by_login[identity] = len(records)
                records.append(credential)
    return records


def replace_runtime_roster(records: list[SteamCredential]) -> None:
    _CREDENTIALS_BY_LABEL.clear()
    _CREDENTIALS_BY_LABEL.update({record.label: record for record in records})


def credential_for_label(label: str) -> SteamCredential | None:
    direct = _CREDENTIALS_BY_LABEL.get(label)
    if direct is not None:
        return direct
    # Legacy database rows may still carry old duplicate labels such as
    # "login#2". They resolve to the one canonical Steam login credential.
    base = str(label or "").split("#", 1)[0].strip().casefold()
    return next(
        (
            credential
            for credential in _CREDENTIALS_BY_LABEL.values()
            if credential.login.casefold() == base
        ),
        None,
    )


def runtime_roster_count() -> int:
    return len(_CREDENTIALS_BY_LABEL)
