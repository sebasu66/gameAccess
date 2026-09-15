import json

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app import main as core


@pytest.mark.parametrize(
    "status,disabled_by_scan,complete,expected",
    [("disabled", True, True, "free"),
     ("disabled", False, True, "disabled"),
     ("leased", True, True, "leased"),
     ("disabled", True, False, "disabled")],
)
def test_individual_scan_recovers_only_scan_disabled_accounts(
    tmp_path, status, disabled_by_scan, complete, expected,
):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        account = core.ProviderAccount(
            label="example", status=status,
            notes=json.dumps({"disabled_by_inventory_scan": disabled_by_scan,
                              "ownership_scan_error": "AlreadyLoggedInElsewhere"}),
        )
        session.add(account)
        session.commit()
        result = core.sync_account(core.SyncAccountRequest(
            label="example", game_ids=[], notes=json.dumps({
                "inventory_complete": complete, "ownership_scan_status": "ok",
            }),
        ), session)
        assert result["account"]["status"] == expected
        session.refresh(account)
        notes = json.loads(account.notes)
        if complete:
            assert notes["ownership_scan_error"] is None
            assert notes["disabled_by_inventory_scan"] is False
        else:
            assert notes["disabled_by_inventory_scan"] is True
