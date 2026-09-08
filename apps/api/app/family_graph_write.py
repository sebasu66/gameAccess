"""Validated, atomic family graph replacement; no Steam operations."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import update
from sqlmodel import Session, select

from . import family_capacity as model
from . import main as core


def _validated_rows(families, accounts, games):
    """Reject ambiguous inventory before deleting or inserting any graph rows."""
    keys, seen_members, copy_keys = set(), set(), set()
    rows = []
    for incoming in families:
        key = str(incoming.get("family_key") or "").strip()
        members = [str(value) for value in incoming.get("members") or []]
        if not key or key in keys:
            raise HTTPException(422, "Family keys must be nonempty and unique")
        keys.add(key)
        for label in members:
            if label not in accounts or label in seen_members:
                raise HTTPException(422, "Each known account must occur in one family")
            seen_members.add(label)
        copies = _validated_copies(incoming, key, members, accounts, games, copy_keys)
        rows.append((key, [accounts[label].id for label in members], copies))
    return rows, seen_members


def _validated_copies(incoming, key, members, accounts, games, seen):
    copies = []
    for entry in incoming.get("licenses") or []:
        owners = [str(value) for value in entry.get("owner_labels") or []]
        quantity = entry.get("quantity")
        quantity = len(owners) if quantity is None else quantity
        if type(quantity) is not int or quantity < 0 or quantity != len(owners):
            raise HTTPException(
                422, "Copy quantity must match distinct verified owners"
            )
        app_id = entry.get("app_id")
        for owner in owners:
            identity = (key, app_id, owner)
            if owner not in members or identity in seen:
                raise HTTPException(422, "Copy owners must be unique family members")
            seen.add(identity)
            game = games.get(app_id)
            if game is not None:
                copies.append((int(game.id), int(accounts[owner].id)))
    return copies


def _fallback_rows(rows, seen, accounts, session):
    # Compatibility only: provenance of synthetic domains is a separate migration.
    mapped = {}
    for mapping in session.exec(select(core.AccountGame)).all():
        mapped.setdefault(mapping.account_id, set()).add(mapping.game_id)
    for label, account in accounts.items():
        if label not in seen:
            copies = [(gid, int(account.id)) for gid in mapped.get(account.id, set())]
            rows.append((f"account:{account.id}", [account.id], copies))
    keys = [row[0] for row in rows]
    if len(keys) != len(set(keys)):
        raise HTTPException(422, "Explicit family key conflicts with fallback domain")


def _require_idle_graph(session):
    # Acquire SQLite's writer reservation BEFORE checking activity or reading graph.
    # No rows are changed, but concurrent graph replacements serialize.
    session.execute(
        update(model.ProviderFamily).where(False).values(id=model.ProviderFamily.id)
    )
    active = session.exec(
        select(core.Lease).where(core.Lease.status == core.LeaseStatus.active)
    ).first()
    leased = session.exec(
        select(core.ProviderAccount).where(
            core.ProviderAccount.status == core.AccountStatus.leased
        )
    ).first()
    if active is not None or leased is not None:
        raise HTTPException(
            409, "Family refresh requires no active leases or leased accounts"
        )


def _desired_graph(session, rows):
    families = {
        row.external_key: row for row in session.exec(select(model.ProviderFamily))
    }
    memberships, copies = set(), set()
    for key, account_ids, owner_copies in rows:
        family = families.get(key)
        if family is None:
            family = model.ProviderFamily(external_key=key, provider="steam")
            session.add(family)
            session.flush()
            families[key] = family
        memberships.update((int(family.id), int(aid)) for aid in account_ids)
        copies.update((int(family.id), gid, owner) for gid, owner in owner_copies)
    return memberships, copies


def _sync_members(session, desired):
    existing = {}
    for row in session.exec(select(model.FamilyMember)).all():
        identity = (row.family_id, row.account_id)
        if identity not in desired or identity in existing:
            session.delete(row)
        else:
            existing[identity] = row
    for family_id, account_id in desired - existing.keys():
        session.add(model.FamilyMember(family_id=family_id, account_id=account_id))


def _sync_copies(session, desired):
    existing, removed = {}, []
    for row in session.exec(select(model.FamilyGameLicenseCopy)).all():
        identity = (row.family_id, row.game_id, row.owner_account_id)
        if identity not in desired or identity in existing:
            removed.append(row)
        else:
            existing[identity] = row
    removed_ids = {row.id for row in removed}
    for allocation in session.exec(select(model.LeaseAllocation)).all():
        if allocation.license_copy_id in removed_ids:
            # Only historical leases exist (checked under writer reservation).
            allocation.license_copy_id = None
            session.add(allocation)
    session.flush()
    for row in removed:
        session.delete(row)
    for family_id, game_id, owner in desired - existing.keys():
        session.add(
            model.FamilyGameLicenseCopy(
                family_id=family_id,
                game_id=game_id,
                owner_account_id=owner,
            )
        )


def replace_family_graph(session: Session, families: list[dict]) -> dict[str, int]:
    """Commit once; validation/errors roll back the entire replacement.

    Existing copy identities retain their IDs. Active allocations are never
    rewritten: a busy graph must be refreshed later, after leases are released.
    """
    try:
        _require_idle_graph(session)
        accounts = {a.label: a for a in session.exec(select(core.ProviderAccount))}
        games = {g.app_id: g for g in session.exec(select(core.Game)) if g.app_id}
        rows, seen = _validated_rows(families, accounts, games)
        _fallback_rows(rows, seen, accounts, session)
        members, copies = _desired_graph(session, rows)
        _sync_members(session, members)
        _sync_copies(session, copies)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return {"families": len(rows), "license_copies": len(copies)}
