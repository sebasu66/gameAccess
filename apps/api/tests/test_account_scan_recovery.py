import json

from sqlmodel import Session, SQLModel, create_engine

from app import main as core


def _session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    SQLModel.metadata.create_all(engine)
    return engine


def test_non_password_scan_failure_never_disables_provider(tmp_path):
    engine = _session(tmp_path)
    with Session(engine) as session:
        account = core.ProviderAccount(
            label="example",
            status=core.AccountStatus.disabled,
            notes=json.dumps({
                "account_name": "example",
                "ownership_scan_error": "AlreadyLoggedInElsewhere",
                "credential_status": "unknown",
            }),
        )
        session.add(account)
        session.commit()

        result = core.sync_account(
            core.SyncAccountRequest(
                label="example",
                game_ids=[],
                notes=json.dumps({
                    "inventory_complete": False,
                    "ownership_scan_status": "temporarily_unavailable",
                    "ownership_scan_error": "AlreadyLoggedInElsewhere",
                    "credential_status": "unknown",
                }),
            ),
            session,
        )

        # Legacy disabled status is no longer an allocation authority. A transient
        # failure also must not invent an invalid-password credential state.
        assert result["account"]["status"] == core.AccountStatus.disabled
        session.refresh(account)
        notes = json.loads(account.notes)
        assert notes["credential_status"] == "unknown"
        assert notes["disabled_by_inventory_scan"] is False


def test_valid_password_reactivates_same_provider_record(tmp_path):
    engine = _session(tmp_path)
    with Session(engine) as session:
        account = core.ProviderAccount(
            label="example#2",
            status=core.AccountStatus.disabled,
            notes=json.dumps({
                "account_name": "example",
                "provider_id": "example",
                "credential_status": "invalid_password",
            }),
        )
        session.add(account)
        session.commit()
        original_id = account.id

        result = core.sync_account(
            core.SyncAccountRequest(
                label="example",
                game_ids=[],
                notes=json.dumps({
                    "account_name": "example",
                    "provider_id": "example",
                    "inventory_complete": True,
                    "ownership_scan_status": "ok",
                    "credential_status": "valid",
                }),
            ),
            session,
        )

        assert result["created"] is False
        assert result["account"]["id"] == original_id
        assert result["account"]["label"] == "example"
        assert result["account"]["status"] == core.AccountStatus.free
        assert session.get(core.ProviderAccount, original_id).id == original_id
