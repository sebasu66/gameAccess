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
