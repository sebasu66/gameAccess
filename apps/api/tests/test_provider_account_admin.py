from pathlib import Path

from app import admin_console_routes as admin


def test_provider_account_start_keeps_password_out_of_argv_and_response(
    tmp_path: Path, monkeypatch
) -> None:
    script = tmp_path / "provider_account_onboard.py"
    script.write_text("# test script\n", encoding="utf-8")
    captured: dict = {}

    monkeypatch.setattr(admin, "LAUNCHER_ROOT", tmp_path)
    monkeypatch.setattr(admin, "launcher_python", lambda: Path("/python"))

    def fake_start_task(kind, label, argv, *, env=None):
        captured.update(
            {
                "kind": kind,
                "label": label,
                "argv": list(argv),
                "env": dict(env or {}),
            }
        )
        return {"id": "task-1", "kind": kind, "label": label, "status": "running"}

    monkeypatch.setattr(admin, "start_task", fake_start_task)

    result = admin.start_provider_account_onboard(
        admin.ProviderAccountOnboardRequest(
            account_name="seat-01",
            password="super-secret",
        )
    )

    assert captured["kind"] == "provider_account_onboard"
    assert "super-secret" not in " ".join(captured["argv"])
    assert captured["env"]["GAMEACCESS_PROVIDER_ACCOUNT_USER"] == "seat-01"
    assert captured["env"]["GAMEACCESS_PROVIDER_ACCOUNT_PASSWORD"] == "super-secret"
    assert "password" not in result
    assert result["scan_scope"] == "single-provider"
    assert result["catalog_update"] == "single-account-only"
