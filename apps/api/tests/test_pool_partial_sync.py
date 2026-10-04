import json

from sqlmodel import Session, SQLModel, create_engine, select

from app import main as core
from app import pool_routes
from app.account_roster import SteamCredential
from app.pool_routes import PoolAccountInput, PoolSyncInput, _sync_account


def _make_session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'pool-test.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_partial_catalog_sync_preserves_authoritative_account_games(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = core.Game(slug="test-game", name="Test Game", app_id=730, active=True)
        account = core.ProviderAccount(
            label="provider-test",
            provider="steam",
            notes=json.dumps(
                {
                    "ownership_source": "steamkit-license-list-pics",
                    "ownership_verified_at": "2026-09-04T12:00:00+00:00",
                    "inventory_complete": True,
                }
            ),
        )
        session.add(game)
        session.add(account)
        session.commit()
        session.refresh(game)
        session.refresh(account)
        session.add(core.AccountGame(account_id=account.id, game_id=game.id))
        session.commit()

        partial_req = PoolSyncInput(
            source="steam-local-provider-library-cache",
            verification_complete=False,
            accounts=[],
            games=[],
        )
        partial_account = PoolAccountInput(
            label="provider-test",
            app_ids=[],
            accessible_app_ids=[730],
            ownership_source="unverified",
            inventory_complete=False,
            scan_status="not_scanned",
        )
        _sync_account(partial_req, partial_account, {730: game}, session)

        mappings = session.exec(
            select(core.AccountGame).where(core.AccountGame.account_id == account.id)
        ).all()
        assert len(mappings) == 1
        refreshed = session.get(core.ProviderAccount, account.id)
        notes = json.loads(refreshed.notes)
        assert notes["ownership_source"] == "steamkit-license-list-pics"
        assert notes["inventory_complete"] is True
        assert notes["accessible_app_ids"] == [730]

        complete_req = PoolSyncInput(
            source="steamkit-license-list-pics",
            verification_complete=True,
            verified_at="2026-09-04T13:00:00+00:00",
            accounts=[],
            games=[],
        )
        complete_account = PoolAccountInput(
            label="provider-test",
            app_ids=[],
            accessible_app_ids=[730],
            ownership_source="steamkit-license-list-pics",
            inventory_complete=True,
            scan_status="ok",
        )
        _sync_account(complete_req, complete_account, {730: game}, session)

        mappings = session.exec(
            select(core.AccountGame).where(core.AccountGame.account_id == account.id)
        ).all()
        assert mappings == []


def test_verified_account_updates_even_when_global_scan_is_partial(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        old_game = core.Game(slug="old-game", name="Old Game", app_id=730, active=True)
        new_game = core.Game(slug="new-game", name="New Game", app_id=570, active=True)
        account = core.ProviderAccount(label="provider-ok", provider="steam")
        session.add(old_game)
        session.add(new_game)
        session.add(account)
        session.commit()
        session.refresh(old_game)
        session.refresh(new_game)
        session.refresh(account)
        session.add(core.AccountGame(account_id=account.id, game_id=old_game.id))
        session.commit()

        req = PoolSyncInput(
            source="steamkit-license-list-pics",
            verification_complete=False,
            verified_at="2026-09-04T18:21:14+00:00",
            accounts=[],
            games=[],
        )
        incoming = PoolAccountInput(
            label="provider-ok",
            app_ids=[570],
            accessible_app_ids=[570],
            ownership_source="steamkit-license-list-pics",
            ownership_verified_at="2026-09-04T18:21:14+00:00",
            inventory_complete=True,
            scan_status="ok",
        )
        _sync_account(req, incoming, {730: old_game, 570: new_game}, session)

        mappings = session.exec(
            select(core.AccountGame).where(core.AccountGame.account_id == account.id)
        ).all()
        assert {row.game_id for row in mappings} == {new_game.id}
        refreshed = session.get(core.ProviderAccount, account.id)
        notes = json.loads(refreshed.notes)
        assert notes["inventory_complete"] is True
        assert notes["ownership_scan_status"] == "ok"


def test_busy_scan_preserves_valid_account_and_ownership(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = core.Game(slug="test-game", name="Test Game", app_id=730, active=True)
        account = core.ProviderAccount(
            label="provider-failed",
            provider="steam",
            status=core.AccountStatus.free,
        )
        session.add(game)
        session.add(account)
        session.commit()
        session.refresh(game)
        session.refresh(account)
        session.add(core.AccountGame(account_id=account.id, game_id=game.id))
        session.commit()

        req = PoolSyncInput(
            source="steamkit-license-list-pics",
            verification_complete=False,
            accounts=[],
            games=[],
        )
        failed = PoolAccountInput(
            label="provider-failed",
            app_ids=[],
            accessible_app_ids=[730],
            inventory_complete=False,
            scan_status="logon_error",
            scan_error="AlreadyLoggedInElsewhere",
        )
        _sync_account(req, failed, {730: game}, session)

        refreshed = session.get(core.ProviderAccount, account.id)
        assert refreshed.status == core.AccountStatus.free
        mappings = session.exec(
            select(core.AccountGame).where(core.AccountGame.account_id == account.id)
        ).all()
        assert len(mappings) == 1
        notes = json.loads(refreshed.notes)
        assert notes["disabled_by_inventory_scan"] is False
        assert notes["ownership_scan_error"] == "AlreadyLoggedInElsewhere"

        recovered = PoolAccountInput(
            label="provider-failed",
            app_ids=[730],
            accessible_app_ids=[730],
            ownership_source="steamkit-license-list-pics",
            inventory_complete=True,
            scan_status="ok",
        )
        _sync_account(req, recovered, {730: game}, session)
        refreshed = session.get(core.ProviderAccount, account.id)
        assert refreshed.status == core.AccountStatus.free
        notes = json.loads(refreshed.notes)
        assert notes["disabled_by_inventory_scan"] is False


def test_explicit_invalid_password_disables_then_valid_scan_reactivates(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = core.Game(slug="credential-game", name="Credential Game", app_id=999, active=True)
        account = core.ProviderAccount(
            label="credential-provider",
            provider="steam",
            status=core.AccountStatus.free,
        )
        session.add_all([game, account])
        session.commit()
        session.refresh(game)
        session.refresh(account)
        session.add(core.AccountGame(account_id=account.id, game_id=game.id))
        session.commit()

        req = PoolSyncInput(
            source="steamkit-license-list-pics",
            verification_complete=False,
            accounts=[],
            games=[],
        )
        invalid = PoolAccountInput(
            label="credential-provider",
            app_ids=[],
            accessible_app_ids=[999],
            inventory_complete=False,
            scan_status="authentication_error",
            scan_error="InvalidPassword",
        )
        _sync_account(req, invalid, {999: game}, session)

        session.refresh(account)
        notes = json.loads(account.notes)
        assert account.status == core.AccountStatus.disabled
        assert notes["credential_status"] == "invalid_password"
        assert notes["credential_error"] == "InvalidPassword"

        recovered = PoolAccountInput(
            label="credential-provider",
            app_ids=[999],
            accessible_app_ids=[999],
            ownership_source="steamkit-license-list-pics",
            inventory_complete=True,
            scan_status="ok",
        )
        _sync_account(req, recovered, {999: game}, session)

        session.refresh(account)
        notes = json.loads(account.notes)
        assert account.status == core.AccountStatus.free
        assert notes["credential_status"] == "valid"
        assert notes["credential_error"] is None


def test_runtime_roster_merges_legacy_duplicate_provider_rows(tmp_path, monkeypatch) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = core.Game(slug="merge-game", name="Merge Game", app_id=123, active=True)
        canonical = core.ProviderAccount(
            label="alice",
            provider="steam",
            notes=json.dumps({"account_name": "alice"}),
        )
        duplicate = core.ProviderAccount(
            label="alice#2",
            provider="steam",
            notes=json.dumps({"account_name": "alice"}),
        )
        session.add_all([game, canonical, duplicate])
        session.commit()
        session.refresh(game)
        session.refresh(canonical)
        session.refresh(duplicate)
        duplicate_id = duplicate.id

        session.add(core.AccountGame(account_id=duplicate.id, game_id=game.id))
        lease = core.Lease(
            user_id=1,
            game_id=game.id,
            account_id=duplicate.id,
            starts_at=core.now_utc(),
            expires_at=core.now_utc(),
            credits_spent=0,
            status=core.LeaseStatus.active,
        )
        session.add(lease)
        session.commit()
        session.refresh(lease)

        monkeypatch.setattr(
            pool_routes,
            "load_account_roster",
            lambda: [SteamCredential(label="alice", login="alice", password="new-password")],
        )

        count = pool_routes.sync_runtime_account_roster(session)

        assert count == 1
        accounts = session.exec(select(core.ProviderAccount)).all()
        assert [(row.id, row.label) for row in accounts] == [(canonical.id, "alice")]
        assert session.get(core.ProviderAccount, duplicate_id) is None
        session.refresh(lease)
        assert lease.account_id == canonical.id
        mappings = session.exec(
            select(core.AccountGame).where(core.AccountGame.account_id == canonical.id)
        ).all()
        assert [row.game_id for row in mappings] == [game.id]
