from __future__ import annotations

import csv
from pathlib import Path
from types import SimpleNamespace

import provider_license_scan as scan
from provider_roster import load_provider_credentials


def test_roster_preserves_parentheses_and_shell_metacharacters(tmp_path: Path) -> None:
    path = tmp_path / "accFull.csv"
    password = "p)a(ss&word%with!shell^chars"
    with path.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerow(["example-user", password])

    credentials = load_provider_credentials(path)

    assert len(credentials) == 1
    assert credentials[0].password == password


def test_roster_supports_csv_quoted_password_with_comma_and_parenthesis(tmp_path: Path) -> None:
    path = tmp_path / "accFull.csv"
    password = 'p),ass"word'
    with path.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerow(["example-user", password])

    credentials = load_provider_credentials(path)

    assert credentials[0].password == password


def test_steamkit_password_is_passed_only_through_environment(monkeypatch) -> None:
    password = "p)a(ss&word%with!shell^chars"
    captured: dict[str, object] = {}

    def fake_run(argv, **kwargs):
        captured["argv"] = list(argv)
        captured["env"] = dict(kwargs["env"])
        return SimpleNamespace(
            returncode=0,
            stdout='{"status":"ok","complete":true,"packages":[]}\n',
            stderr="",
        )

    monkeypatch.setattr(scan.subprocess, "run", fake_run)

    result = scan._run_provider(
        "example-user",
        password,
        login_id=12345,
        timeout_seconds=20,
    )

    assert result["status"] == "ok"
    assert captured["env"]["GA_STEAM_PASS"] == password
    assert password not in captured["argv"]
