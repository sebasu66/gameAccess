import sqlite3
from concurrent.futures import ThreadPoolExecutor

from provider_family_evidence import merge_family_evidence


def scan(provider, apps, day, *, status="ok", complete=True):
    return {
        "verified_at": f"2026-09-{day:02d}T00:00:00+00:00",
        "complete": False,
        "scans": [{"provider_id": provider, "status": status, "complete": complete}],
        "accounts": [
            {
                "provider_id": provider,
                "scan_status": status,
                "owned_app_ids": apps,
                "accessible_app_ids": [],
                "family_key": "shared-family",
                "family_member_provider_ids": ["A", "B"],
                "password": "must-not-persist",
            }
        ],
    }


def by_provider(value):
    return {row["provider_id"]: row for row in value["accounts"]}


def test_successive_partial_successes_survive_old_baseline_and_restart(tmp_path):
    path = tmp_path / "evidence.db"
    baseline = scan("A", [1], 4)
    baseline["complete"] = True
    merge_family_evidence(baseline, scan("A", [2], 6), path)
    result = merge_family_evidence(baseline, scan("B", [3], 8), path)
    rows = by_provider(result)
    assert rows["A"]["owned_app_ids"] == [2]
    assert rows["B"]["owned_app_ids"] == [3]
    assert rows["A"]["accessible_app_ids"] == []
    assert result["complete"] is False
    with sqlite3.connect(path) as db:
        assert all(
            "password" not in row[0]
            for row in db.execute("SELECT payload FROM provider_evidence")
        )


def test_failed_incomplete_and_stale_scans_cannot_erase_verified_evidence(tmp_path):
    path = tmp_path / "evidence.db"
    merge_family_evidence({}, scan("A", [2], 6), path)
    for incoming in [
        scan("A", [], 8, status="timeout"),
        scan("A", [], 8, complete=False),
        scan("A", [1], 4),
        scan("A", [], 8, status="not_scanned"),
    ]:
        result = merge_family_evidence({}, incoming, path)
        assert by_provider(result)["A"]["owned_app_ids"] == [2]


def test_selected_filter_does_not_sync_unrequested_provider(tmp_path):
    result = merge_family_evidence(
        {},
        scan("B", [3], 8),
        tmp_path / "evidence.db",
        selected={"A"},
    )
    assert result["accounts"] == []


def test_family_query_error_is_not_confirmed_standalone(tmp_path):
    incoming = scan("A", [3], 8)
    incoming["accounts"][0]["family_key"] = "standalone:A"
    incoming["scans"][0]["family_error"] = "timeout"
    result = merge_family_evidence({}, incoming, tmp_path / "evidence.db")
    row = by_provider(result)["A"]
    assert row["owned_app_ids"] == [3]
    assert row["family_key"] == ""
    assert row["family_status"] == "unknown"


def test_concurrent_workers_preserve_both_successes(tmp_path):
    path = tmp_path / "evidence.db"
    with ThreadPoolExecutor(max_workers=2) as workers:
        futures = [
            workers.submit(merge_family_evidence, {}, scan(p, [n], 8), path)
            for n, p in enumerate(["A", "B"])
        ]
        for future in futures:
            future.result()
    result = merge_family_evidence({}, {}, path)
    assert set(by_provider(result)) == {"A", "B"}

