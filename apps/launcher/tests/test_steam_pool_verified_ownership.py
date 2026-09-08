import steam_pool as pool


def _identity(user_id: int, name: str) -> dict:
    return {
        "display_name": name,
        "account_name": name,
        "steam_id64": str(pool.STEAM_ID64_BASE + user_id),
        "user_id32": user_id,
    }


def test_ticketed_cyberpunk_never_becomes_owned_without_verified_license(monkeypatch) -> None:
    cyberpunk = 1091500
    monkeypatch.setattr(pool, "active_user_id32", lambda: 202)
    monkeypatch.setattr(pool, "remembered_account_identities", lambda: [_identity(202, "vz3644")])
    monkeypatch.setattr(pool, "local_library_apps", lambda user_id: {cyberpunk: {}})
    monkeypatch.setattr(pool, "local_ticketed_apps", lambda user_id: {cyberpunk})
    monkeypatch.setattr(
        pool,
        "load_verified_owner_cache",
        lambda: {
            "available": True,
            "complete": False,
            "verified_at": "2026-08-30T06:10:57+00:00",
            "source": "steam-console-licenses-print-cache",
            "owner_apps": {},
            "scanned_user_ids": {202},
            "error": "partial cache",
        },
    )

    result = pool.scan_pool()
    account = result["accounts"][0]

    assert account["accessible_app_ids"] == [cyberpunk]
    assert account["ticketed_app_count"] == 1
    assert account["ownership_verified"] is True
    assert account["app_ids"] == []
    assert str(cyberpunk) not in result["licenses"]
    assert result["unique_app_count"] == 0


def test_only_verified_owner_cache_populates_app_ids(monkeypatch) -> None:
    app_id = 10
    monkeypatch.setattr(pool, "active_user_id32", lambda: 101)
    monkeypatch.setattr(pool, "remembered_account_identities", lambda: [_identity(101, "owner")])
    monkeypatch.setattr(pool, "local_library_apps", lambda user_id: {app_id: {}})
    monkeypatch.setattr(pool, "local_ticketed_apps", lambda user_id: set())
    monkeypatch.setattr(
        pool,
        "load_verified_owner_cache",
        lambda: {
            "available": True,
            "complete": True,
            "verified_at": "2026-09-08T00:00:00+00:00",
            "source": "steam-console-licenses-print-cache",
            "owner_apps": {101: {app_id}},
            "scanned_user_ids": {101},
            "error": None,
        },
    )

    result = pool.scan_pool()
    account = result["accounts"][0]
    assert account["app_ids"] == [app_id]
    assert result["licenses"] == {str(app_id): ["owner"]}
    assert result["ownership_complete"] is True


def test_unverified_account_fails_closed_even_when_ticket_exists(monkeypatch) -> None:
    app_id = 999
    monkeypatch.setattr(pool, "active_user_id32", lambda: 202)
    monkeypatch.setattr(pool, "remembered_account_identities", lambda: [_identity(202, "unverified")])
    monkeypatch.setattr(pool, "local_library_apps", lambda user_id: {app_id: {}})
    monkeypatch.setattr(pool, "local_ticketed_apps", lambda user_id: {app_id})
    monkeypatch.setattr(
        pool,
        "load_verified_owner_cache",
        lambda: {
            "available": True,
            "complete": False,
            "verified_at": "2026-09-08T00:00:00+00:00",
            "source": "steam-console-licenses-print-cache",
            "owner_apps": {101: {10}},
            "scanned_user_ids": {101},
            "error": "partial cache",
        },
    )

    result = pool.scan_pool()
    account = result["accounts"][0]
    assert account["ownership_verified"] is False
    assert account["ownership_source"] == "unverified"
    assert account["app_ids"] == []
    assert result["licenses"] == {}
