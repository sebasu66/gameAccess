import provider_license_scan as scan
from provider_roster import ProviderCredential


def test_partial_scan_separates_owned_from_family_accessible_apps(monkeypatch) -> None:
    credential = ProviderCredential(
        provider_id="provider-001",
        label="seat-1",
        login="seat-1",
        password="secret",
    )
    steam_id64 = scan.STEAM_ID64_ACCOUNT_BASE + 111

    monkeypatch.setattr(scan, "ensure_scanner_built", lambda: None)
    monkeypatch.setattr(scan, "load_provider_credentials", lambda: [credential])
    monkeypatch.setattr(
        scan,
        "match_provider_identities",
        lambda: {
            "accounts": [
                {
                    "provider_id": "provider-001",
                    "steam_id64": str(steam_id64),
                    "user_id32": 111,
                }
            ]
        },
    )
    monkeypatch.setattr(
        scan,
        "_run_provider",
        lambda *args, **kwargs: {
            "status": "ok",
            "complete": True,
            "steam_id64": str(steam_id64),
            "family_group_id": 0,
            "is_not_member_of_any_group": True,
            "packages": [
                {
                    "owner_account_id": 111,
                    "borrowed": False,
                    "non_permanent": False,
                    "app_ids": [10],
                },
                {
                    "owner_account_id": 222,
                    "borrowed": True,
                    "non_permanent": False,
                    "app_ids": [20],
                },
            ],
        },
    )

    inventory = scan.scan_provider_licenses(provider_ids={"provider-001"})
    account = inventory["accounts"][0]

    assert account["owned_app_ids"] == [10]
    assert account["accessible_app_ids"] == [10, 20]
