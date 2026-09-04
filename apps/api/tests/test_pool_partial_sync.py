import json

from sqlmodel import Session, SQLModel, create_engine, select

from app import main as core
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


def test_failed_scan_disables_seat_without_erasing_ownership_and_success_recovers(tmp_path) -> None:
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
        assert refreshed.status == core.AccountStatus.disabled
        mappings = session.exec(
            select(core.AccountGame).where(core.AccountGame.account_id == account.id)
        ).all()
        assert len(mappings) == 1
        notes = json.loads(refreshed.notes)
        assert notes["disabled_by_inventory_scan"] is True
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
