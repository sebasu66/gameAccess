"""Canonical local GameAccess Steam provider roster.

The provider set comes exclusively from ``cuentas.txt``.  It is intentionally
separate from Steam's remembered/local-user accounts.  Credentials are read
only at runtime and are never serialized by this module.
"""
from __future__ import annotations

import os
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from steam_pool import STEAM_ID64_BASE, _ci_get, _read_vdf, steam_root


@dataclass(frozen=True)
class ProviderCredential:
    provider_id: str
    label: str
    login: str
    password: str


def configured_accounts_path() -> Path:
    configured = os.environ.get("GAMEACCESS_ACCOUNTS_FILE", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[2] / "cuentas.txt"


def _unwrap(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"`", "'"}:
        return value[1:-1]
    return value


def load_provider_credentials(path: Path | None = None) -> list[ProviderCredential]:
    source = path or configured_accounts_path()
    if not source.is_file():
        return []

    seen_pairs: set[tuple[str, str]] = set()
    login_counts: defaultdict[str, int] = defaultdict(int)
    records: list[ProviderCredential] = []
    for raw_line in source.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        cells = [cell.strip() for cell in raw_line.split("|")]
        while cells and not cells[0]:
            cells.pop(0)
        while cells and not cells[-1]:
            cells.pop()
        if len(cells) < 3:
            continue

        login = _unwrap(cells[1])
        password = _unwrap(cells[2])
        if login == "Usuario (Login)" and password == "Contraseña (Pass)":
            continue
        if not login and not password:
            continue
        pair = (login, password)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        login_counts[login] += 1
        occurrence = login_counts[login]
        label = login if occurrence == 1 else f"{login}#{occurrence}"
        records.append(
            ProviderCredential(
                provider_id=f"provider-{len(records) + 1:03d}",
                label=label,
                login=login,
                password=password,
            )
        )
    return records


def steam_account_identities() -> list[dict[str, Any]]:
    """Return all identities in loginusers.vdf, including non-remembered users.

    This function does not modify Steam state.  Provider accounts remain
    non-remembered unless Steam itself already marked them otherwise.
    """
    root = steam_root()
    if not root:
        return []
    path = root / "config" / "loginusers.vdf"
    if not path.is_file():
        return []
    try:
        parsed = _read_vdf(path)
        users = _ci_get(parsed, "users")
        if not isinstance(users, dict):
            return []
        result: list[dict[str, Any]] = []
        for steam_id64, fields in users.items():
            if not str(steam_id64).isdigit() or not isinstance(fields, dict):
                continue
            account_name = str(_ci_get(fields, "AccountName") or "").strip()
            if not account_name:
                continue
            persona_name = str(_ci_get(fields, "PersonaName") or account_name).strip()
            steam64 = int(steam_id64)
            user32 = steam64 - STEAM_ID64_BASE if steam64 >= STEAM_ID64_BASE else None
            if user32 is not None and user32 <= 0:
                user32 = None
            result.append(
                {
                    "steam_id64": str(steam_id64),
                    "user_id32": user32,
                    "account_name": account_name,
                    "display_name": persona_name,
                    "remembered": str(_ci_get(fields, "RememberPassword") or "").strip() == "1",
                }
            )
        return result
    except Exception:
        return []


def match_provider_identities(path: Path | None = None) -> dict[str, Any]:
    """Map the cuentas.txt provider roster to existing local Steam identities.

    Passwords never leave ``credentials`` and are not included in the returned
    public mapping.  Matching is case-insensitive on the Steam account name.
    """
    credentials = load_provider_credentials(path)
    identities = steam_account_identities()
    by_login: dict[str, dict[str, Any]] = {}
    for identity in identities:
        login = str(identity.get("account_name") or "").casefold()
        if login and login not in by_login:
            by_login[login] = identity

    accounts: list[dict[str, Any]] = []
    missing_provider_ids: list[str] = []
    for credential in credentials:
        identity = by_login.get(credential.login.casefold())
        if identity is None:
            missing_provider_ids.append(credential.provider_id)
            accounts.append(
                {
                    "provider_id": credential.provider_id,
                    "label": credential.label,
                    "account_name": credential.login,
                    "steam_id64": "",
                    "user_id32": None,
                    "remembered": False,
                    "matched": False,
                }
            )
            continue
        accounts.append(
            {
                "provider_id": credential.provider_id,
                "label": credential.label,
                "account_name": credential.login,
                "steam_id64": identity.get("steam_id64") or "",
                "user_id32": identity.get("user_id32"),
                "remembered": bool(identity.get("remembered")),
                "matched": True,
            }
        )

    return {
        "roster_count": len(credentials),
        "matched_identity_count": sum(1 for item in accounts if item["matched"]),
        "missing_identity_count": len(missing_provider_ids),
        "missing_provider_ids": missing_provider_ids,
        "accounts": accounts,
    }


def credential_by_provider_id(provider_id: str, path: Path | None = None) -> ProviderCredential | None:
    for credential in load_provider_credentials(path):
        if credential.provider_id == provider_id:
            return credential
    return None
