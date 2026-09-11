import provider_license_scan as scan
import provider_steam_login as client


def test_visible_retry_uses_same_credentials_without_remember(monkeypatch, tmp_path):
    commands = []
    outcomes = iter(["timeout", "ok"])
    monkeypatch.setattr(client, "_find_steam_exe", lambda: tmp_path / "steam.exe")
    monkeypatch.setattr(client, "_stop_steam", lambda _: None)
    monkeypatch.setattr(client, "_steam_running", lambda: False)
    monkeypatch.setattr(client, "_wait_login", lambda *args: next(outcomes))
    monkeypatch.setattr(client.subprocess, "Popen", lambda argv, **kw: commands.append(argv))
    result = client.login_credentials("example", "p)&word")
    assert result["ok"] and result["mode"] == "visible"
    assert commands == [
        [str(tmp_path / "steam.exe"), "-login", "example", "p)&word"],
        [str(tmp_path / "steam.exe"), "-login", "example", "p)&word"],
    ]


def test_silent_success_does_not_restart(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(client, "_find_steam_exe", lambda: tmp_path / "steam.exe")
    monkeypatch.setattr(client, "_stop_steam", lambda _: None)
    monkeypatch.setattr(client, "_steam_running", lambda: False)
    monkeypatch.setattr(client, "_wait_login", lambda *args: "ok")
    monkeypatch.setattr(client.subprocess, "Popen", lambda argv, **kw: commands.append(argv))
    assert client.login_credentials("example", "pw")["mode"] == "silent"
    assert len(commands) == 1


def test_wait_requires_fresh_matching_account_success(tmp_path):
    log = tmp_path / "log"
    log.write_text("Login: OnLoginStateChange example 5 1 0 0\n")
    offset = log.stat().st_size
    with log.open("a") as handle:
        handle.write("Login: OnLoginStateChange other 5 1 0 0\n")
        handle.write("Login: OnLoginStateChange example 1 50 0 0\n")
    assert client._wait_login(log, offset, "example", 1) == "session_conflict"


def test_scan_retries_authoritative_scan_after_client_recovery(monkeypatch):
    monkeypatch.setattr(client, "login_credentials", lambda *a, **kw: {"ok": True, "mode": "visible"})
    monkeypatch.setattr(scan, "_run_provider", lambda *a, **kw: {"status": "ok", "complete": True, "packages": []})
    result = scan._recover_login("example", "pw", {"status": "logon_error"}, login_id=1, timeout_seconds=20)
    assert result["complete"] and result["login_recovery"]["mode"] == "visible"


def test_client_success_does_not_promote_failed_license_scan(monkeypatch):
    monkeypatch.setattr(client, "login_credentials", lambda *a, **kw: {"ok": True})
    monkeypatch.setattr(scan, "_run_provider", lambda *a, **kw: {"status": "guard_required"})
    result = scan._recover_login("example", "pw", {"status": "logon_error"}, login_id=1, timeout_seconds=20)
    assert result["status"] == "guard_required" and not result.get("complete")


def test_successful_scan_never_opens_client(monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Unexpected desktop login")
    monkeypatch.setattr(client, "login_credentials", unexpected)
    result = {"status": "ok", "complete": True}
    assert scan._recover_login("example", "pw", result, login_id=1, timeout_seconds=20) is result


def test_failed_client_recovery_preserves_scan_failure(monkeypatch):
    monkeypatch.setattr(client, "login_credentials", lambda *a, **kw: {"ok": False, "status": "timeout"})
    def unexpected(*args, **kwargs):
        raise AssertionError("Must not rescan after unsuccessful login")
    monkeypatch.setattr(scan, "_run_provider", unexpected)
    result = scan._recover_login("example", "pw", {"status": "logon_error"}, login_id=1, timeout_seconds=20)
    assert result["status"] == "logon_error" and not result.get("complete")


def test_busy_scan_does_not_attempt_to_replace_session(monkeypatch):
    def unexpected(*a, **kw):
        raise AssertionError("Busy account must not trigger another login")
    monkeypatch.setattr(client, "login_credentials", unexpected)
    result = scan._recover_login("example", "pw", {
        "status": "logon_error", "result": "AlreadyLoggedInElsewhere",
    }, login_id=1, timeout_seconds=20)
    assert result["status"] == "temporarily_unavailable"


def test_busy_client_does_not_use_visible_fallback(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(client, "_find_steam_exe", lambda: tmp_path / "steam.exe")
    monkeypatch.setattr(client, "_stop_steam", lambda _: None)
    monkeypatch.setattr(client, "_steam_running", lambda: False)
    monkeypatch.setattr(client, "_wait_login", lambda *args: "session_conflict")
    monkeypatch.setattr(client.subprocess, "Popen", lambda argv, **kw: commands.append(argv))
    result = client.login_credentials("example", "pw")
    assert not result["ok"] and result["status"] == "session_conflict"
    assert len(commands) == 1
