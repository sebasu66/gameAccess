from provider_license_scan import _resolve_original_owner_provider


def test_owner_account_id_wins_even_without_borrowed_flag() -> None:
    owner = _resolve_original_owner_provider(
        current_provider_id="provider-002",
        current_user_id32=222,
        owner_account_id=111,
        borrowed=False,
        owner_provider_by_user32={111: "provider-001", 222: "provider-002"},
    )
    assert owner == "provider-001"


def test_unmapped_foreign_owner_never_falls_back_to_family_member() -> None:
    owner = _resolve_original_owner_provider(
        current_provider_id="provider-002",
        current_user_id32=222,
        owner_account_id=111,
        borrowed=False,
        owner_provider_by_user32={222: "provider-002"},
    )
    assert owner is None


def test_matching_owner_account_is_direct_owner() -> None:
    owner = _resolve_original_owner_provider(
        current_provider_id="provider-001",
        current_user_id32=111,
        owner_account_id=111,
        borrowed=False,
        owner_provider_by_user32={111: "provider-001"},
    )
    assert owner == "provider-001"


def test_scan_resolves_owner_scanned_later(monkeypatch) -> None:
    import provider_license_scan as scan
    from provider_roster import ProviderCredential

    credentials = [
        ProviderCredential("borrower", "borrower", "borrower", "pw1"),
        ProviderCredential("owner", "owner", "owner", "pw2"),
    ]
    monkeypatch.setattr(scan, "ensure_scanner_built", lambda: None)
    monkeypatch.setattr(scan, "load_provider_credentials", lambda: credentials)
    monkeypatch.setattr(
        scan,
        "match_provider_identities",
        lambda: {"accounts": []},
    )

    payloads = {
        "borrower": {
            "status": "ok",
            "complete": True,
            "steam_id64": str(scan.STEAM_ID64_ACCOUNT_BASE + 222),
            "packages": [
                {
                    "app_ids": [1234],
                    "owner_account_id": 111,
                    "borrowed": True,
                    "non_permanent": False,
                }
            ],
            "is_not_member_of_any_group": True,
        },
        "owner": {
            "status": "ok",
            "complete": True,
            "steam_id64": str(scan.STEAM_ID64_ACCOUNT_BASE + 111),
            "packages": [],
            "is_not_member_of_any_group": True,
        },
    }

    def fake_run_provider(login, _password, *, login_id, timeout_seconds):
        return {**payloads[login], "login_id": login_id}

    monkeypatch.setattr(scan, "_run_provider", fake_run_provider)

    inventory = scan.scan_provider_licenses()
    accounts = {
        row["provider_id"]: row for row in inventory["accounts"]
    }

    assert inventory["unmapped_owner_count"] == 0
    assert accounts["owner"]["owned_app_ids"] == [1234]
    assert accounts["borrower"]["accessible_app_ids"] == [1234]
