import pool_sync
import provider_inventory


def test_verified_owned_app_is_metadata_candidate_when_local_library_hides_it(
    monkeypatch, tmp_path
) -> None:
    app_id = 1091500
    appinfo = tmp_path / "appcache" / "appinfo.vdf"
    appinfo.parent.mkdir(parents=True)
    appinfo.write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr(
        provider_inventory,
        "match_provider_identities",
        lambda: {
            "accounts": [
                {
                    "provider_id": "provider-001",
                    "label": "seat-1",
                    "account_name": "seat-1",
                    "steam_id64": "76561198000000111",
                    "user_id32": 111,
                    "remembered": True,
                    "matched": True,
                }
            ],
            "roster_count": 1,
            "matched_identity_count": 1,
            "missing_identity_count": 0,
            "missing_provider_ids": [],
        },
    )
    monkeypatch.setattr(provider_inventory, "local_library_apps", lambda _user_id: {})
    monkeypatch.setattr(provider_inventory, "steam_root", lambda: tmp_path)

    observed_candidates: set[int] = set()

    def fake_catalog(_path, candidate_ids):
        observed_candidates.update(candidate_ids)
        return {
            app_id: {
                "type": "game",
                "oslist": "windows",
                "name": "Cyberpunk 2077",
                "developer": "CD PROJEKT RED",
                "publisher": "CD PROJEKT RED",
            }
        }

    monkeypatch.setattr(provider_inventory, "read_local_app_catalog", fake_catalog)

    catalog = provider_inventory.build_provider_catalog(
        additional_candidate_ids={app_id}
    )

    assert observed_candidates == {app_id}
    assert [game["app_id"] for game in catalog["games"]] == [app_id]
    assert catalog["accounts"][0]["accessible_app_ids"] == []


def test_pool_seeds_catalog_from_verified_steamkit_ownership(monkeypatch) -> None:
    app_id = 1091500
    observed_candidates: set[int] = set()

    monkeypatch.setattr(
        pool_sync,
        "_ownership_state_by_provider",
        lambda: (
            {
                "provider-001": {
                    "owned_app_ids": {app_id},
                    "inventory_complete": True,
                    "ownership_source": "steamkit-license-list-pics",
                    "ownership_verified_at": "2026-09-08T20:00:00+00:00",
                    "scan_status": "ok",
                    "scan_error": None,
                }
            },
            {
                "source": "steamkit-license-list-pics",
                "verified_at": "2026-09-08T20:00:00+00:00",
                "verification_errors": [],
                "latest_inventory_complete": True,
            },
        ),
    )

    def fake_provider_catalog(additional_candidate_ids=None):
        observed_candidates.update(additional_candidate_ids or set())
        return {
            "ok": True,
            "source": "steam-local-provider-library-cache",
            "accounts": [
                {
                    "provider_id": "provider-001",
                    "label": "seat-1",
                    "account_name": "seat-1",
                    "steam_id64": "76561198000000111",
                    "user_id32": 111,
                    "remembered": True,
                    "matched": True,
                    # Deliberately absent locally: this is the regression case.
                    "accessible_app_ids": [],
                }
            ],
            "games": [
                {
                    "app_id": app_id,
                    "name": "Cyberpunk 2077",
                    "developer": "CD PROJEKT RED",
                    "publisher": "CD PROJEKT RED",
                }
            ],
            "roster_count": 1,
            "matched_identity_count": 1,
            "missing_identity_count": 0,
            "missing_provider_ids": [],
            "all_provider_remember_false": False,
            "candidate_app_count": 1,
            "accessible_unique_app_count": 0,
        }

    monkeypatch.setattr(pool_sync, "build_provider_catalog", fake_provider_catalog)
    monkeypatch.setattr(pool_sync, "steam_root", lambda: None)

    pool = pool_sync.build_game_pool()

    assert observed_candidates == {app_id}
    assert pool["licenses"] == {str(app_id): ["provider-001"]}
    assert [game["app_id"] for game in pool["games"]] == [app_id]
    assert pool["accounts"][0]["accessible_app_ids"] == []
