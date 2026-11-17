import io
from pathlib import Path
import zipfile

import pytest

from steam_depot import depot_tool, steam_library_handoff as handoff


def test_reads_progress_and_the_total():
    state = depot_tool.DepotState()
    assert state.feed(" 12.50% game\\bin\\client.dll\n") == "progress"
    assert (state.percent, state.file) == (12.5, "game\\bin\\client.dll")
    assert state.feed("Total downloaded: 123456 bytes (130000 bytes uncompressed) from 3 depots") == "done"
    assert state.total_bytes == 123456


def test_asks_for_a_login_instead_of_waiting_on_a_password():
    state = depot_tool.DepotState()
    assert state.feed("Enter account password for \"player\": ") == "login"
    assert state.needs_login


def test_keeps_the_qr_code_to_show_it():
    state = depot_tool.DepotState()
    lines = ["Use the Steam Mobile App to sign in with this QR code:", "█▀▀▀█ ▄ █▀▀▀█", "█ █ █ ▀ █ █ █", "", "Logging in..."]
    events = [state.feed(line) for line in lines]
    assert "qr" in events
    assert state.qr == ["█▀▀▀█ ▄ █▀▀▀█", "█ █ █ ▀ █ █ █"]


@pytest.mark.parametrize("line, reason", [
    ("App 730 (Counter-Strike 2) is not available from this account.", "no_access"),
    ("Access token was rejected.", "auth"),
    ("There is not enough space on the disk.", "no_space"),
])
def test_names_why_it_stopped(line, reason):
    state = depot_tool.DepotState()
    assert state.feed(line) == "failure"
    assert state.failure == reason


def test_command_uses_the_remembered_token_or_a_qr_never_a_password(tmp_path):
    tool = tmp_path / "DepotDownloader.exe"
    remembered = depot_tool.command(tool, 570, tmp_path / "dota", account="player", qr=False, login_id=7)
    assert remembered[remembered.index("-username") + 1] == "player" and "-remember-password" in remembered
    qr = depot_tool.command(tool, 570, tmp_path / "dota", account=None, qr=True, login_id=7)
    assert "-qr" in qr and "-username" not in qr
    assert not any("password" in part and part != "-remember-password" for part in remembered + qr)


def test_refuses_a_tool_that_is_not_the_pinned_release(tmp_path):
    bundle = io.BytesIO()
    with zipfile.ZipFile(bundle, "w") as archive:
        archive.writestr("DepotDownloader.exe", b"not the real tool")
    bundle.seek(0)
    with pytest.raises(RuntimeError, match="pinned release"):
        depot_tool.ensure_tool(tmp_path, fetch=lambda *_args, **_kw: bundle)
    assert not (tmp_path / "DepotDownloader.exe").exists()


def test_hands_the_game_to_steam_without_touching_its_own_manifest(tmp_path):
    folder = handoff.game_dir(tmp_path, "dota 2 beta")
    (folder / ".DepotDownloader").mkdir(parents=True)
    (folder / "game.exe").write_bytes(b"x" * 10)
    size = handoff.finish(folder)
    assert size == 10 and not (folder / ".DepotDownloader").exists()
    manifest = handoff.write_manifest(tmp_path, 570, 'Dota "2"', "dota 2 beta", size)
    text = manifest.read_text(encoding="utf-8")
    assert '"StateFlags"\t\t"1026"' in text and '"installdir"\t\t"dota 2 beta"' in text and 'Dota \\"2\\"' in text
    manifest.write_text("steam's own", encoding="utf-8")
    handoff.write_manifest(tmp_path, 570, "Dota 2", "dota 2 beta", size)
    assert manifest.read_text(encoding="utf-8") == "steam's own"
    assert handoff.install_url(570) == "steam://install/570"
    assert handoff.safe_installdir('Half-Life: "Alyx"?') == "Half-Life Alyx"


# -- a free game, downloaded and played ------------------------------------------------------------------
from steam_depot import free_download  # noqa: E402
from steam_account_manager import SteamAccountManager  # noqa: E402
from steam_account_manager import manager as steam_manager_module  # noqa: E402
from test_steam_account_manager import FakeSteam, Log, OTHER, OWNER, _steam  # noqa: E402


class FakeDepot:
    """DepotDownloader as it answers: no saved token for `no_token`, the game's files for the others."""
    def __init__(self, no_token=(), no_access=False, qr=False):
        self.no_token, self.no_access, self.qr, self.calls = set(no_token), no_access, qr, []

    def __call__(self, argv, on_line):
        account = argv[argv.index("-username") + 1] if "-username" in argv else None
        self.calls.append((account, "-qr" in argv))
        if self.no_access:
            on_line("App 570 (Dota 2) is not available from this account.")
            return 1
        if "-qr" in argv:
            for line in ["Use the Steam Mobile App to sign in with this QR code:", "█▀▀▀█ ▄ █▀▀▀█", ""]:
                on_line(line)
        elif account in self.no_token:
            if on_line(f'Enter account password for "{account}": ') is False:
                return -9
        target = Path(argv[argv.index("-dir") + 1])
        (target / ".DepotDownloader").mkdir(parents=True, exist_ok=True)
        (target / "dota2.exe").write_bytes(b"x" * 64)
        for line in [r" 50.00% game\dota2.exe", r"100.00% game\dota2.exe", "Total downloaded: 64 bytes (64 bytes uncompressed) from 1 depots"]:
            on_line(line)
        return 0


def _accounts():
    return [free_download.Account(OTHER, "other_acc"), free_download.Account(OWNER, "owner_acc", most_recent=True)]


def _roomy(_path):
    from collections import namedtuple
    return namedtuple("Usage", "total used free")(10**12, 0, 10**12)


def test_downloads_a_free_game_into_the_steam_library(tmp_path, monkeypatch):
    monkeypatch.setattr(free_download.shutil, "disk_usage", _roomy)
    library = tmp_path / "Steam"
    depot, progress, said = FakeDepot(no_token={"owner_acc"}), [], []
    result = free_download.download_free_game(570, "Dota 2", installdir="dota 2 beta", accounts=_accounts(),
                                              libraries=[library / "steamapps"], tool=tmp_path / "DepotDownloader.exe", runner=depot,
                                              on_progress=lambda p, f: progress.append(p), on_status=lambda e, i: said.append(e))
    # the most recent account first; it has no saved token, so the next remembered one signs in
    assert depot.calls == [("owner_acc", False), ("other_acc", False)]
    assert progress == [50.0, 100.0] and said == ["target", "account", "account", "handoff"]
    folder = handoff.game_dir(library, "dota 2 beta")
    assert (folder / "dota2.exe").is_file() and not (folder / ".DepotDownloader").exists()
    text = handoff.manifest_path(library, 570).read_text(encoding="utf-8")
    assert f'"LastOwner"\t\t"{OTHER}"' in text and '"StateFlags"\t\t"1026"' in text
    assert result["account"] == "other_acc" and result["size_bytes"] == 64


def test_no_remembered_token_shows_a_qr_code(tmp_path, monkeypatch):
    monkeypatch.setattr(free_download.shutil, "disk_usage", _roomy)
    depot, qr = FakeDepot(no_token={"owner_acc", "other_acc"}), []
    result = free_download.download_free_game(570, "Dota 2", accounts=_accounts(), libraries=[tmp_path / "Steam"],
                                              tool=tmp_path / "x.exe", runner=depot,
                                              on_status=lambda e, i: qr.append(i["lines"]) if e == "qr" else None)
    assert depot.calls[-1] == ("owner_acc", True) and qr == [["█▀▀▀█ ▄ █▀▀▀█"]] and result["qr"]


def test_a_game_steam_does_not_give_this_way_falls_back_to_steams_install(tmp_path, monkeypatch):
    monkeypatch.setattr(free_download.shutil, "disk_usage", _roomy)
    with pytest.raises(free_download.DepotUnavailable):
        free_download.download_free_game(570, "Dota 2", accounts=_accounts(), libraries=[tmp_path / "Steam"],
                                         tool=tmp_path / "x.exe", runner=FakeDepot(no_access=True))
    assert not handoff.is_installed(tmp_path / "Steam", 570)


def test_playing_the_downloaded_game_switches_steam_to_the_account_that_got_it(tmp_path, monkeypatch):
    monkeypatch.delenv("GAMEACCESS_LAUNCHER_DATA", raising=False)
    monkeypatch.setattr(free_download.shutil, "disk_usage", _roomy)
    monkeypatch.setattr(steam_manager_module, "active_id64", lambda: OWNER)
    started = []
    monkeypatch.setattr(steam_manager_module.os, "startfile", started.append, raising=False)
    root = _steam(tmp_path)
    launcher = tmp_path / "launcher"
    launcher.mkdir()
    switched = FakeSteam(active=39734273)                  # Steam is signed in to owner_acc
    steam = SteamAccountManager(launcher, steam_root=root, logger=Log(), switcher=switched.switcher())
    for id64 in (OWNER, OTHER):
        steam.registry.add("steam", id64)
    accounts = [free_download.Account(a.steam_id64, a.account_name, a.most_recent) for a in steam.accounts()]
    free_download.download_free_game(570, "Dota 2", accounts=accounts, libraries=steam.libraries(), tool=tmp_path / "x.exe",
                                     runner=FakeDepot(no_token={"owner_acc"}))
    assert steam.owner_of(570)["owner_name"] == "other_acc"
    outcome = steam.play(570)
    assert switched.calls == [("start", "-shutdown"), ("auto_login", "other_acc"), ("start",)]
    assert started == ["steam://rungameid/570"] and outcome["steam_owner"] == "other_acc"


def test_the_queue_hands_a_steam_depot_source_to_steam(tmp_path):
    from types import SimpleNamespace
    from game_download_manager.pipeline import DownloadPipeline
    events, installed = [], []
    context = SimpleNamespace(logger=Log(), set_route=lambda r: events.append(("route", r)),
                              emit_progress=lambda app, phase, pct, **kw: events.append((phase, kw.get("steam_qr"))),
                              emit_error=lambda app, msg, **kw: events.append(("error", kw.get("error_code"))))
    steam = SimpleNamespace(root=tmp_path, accounts=lambda: [], libraries=lambda: [tmp_path], install=installed.append)

    def download(app_id, name, *, on_progress, on_status, **_):
        on_status("qr", {"lines": ["█▀█"]}); on_progress(50.0, "x"); on_status("handoff", {})
        return {"account": "other_acc", "size_bytes": 1}
    pipeline = DownloadPipeline.__new__(DownloadPipeline)
    pipeline.context = context
    args = SimpleNamespace(download_source="steam-depot:570")
    assert pipeline.depot_tool_download(args, "570", "Dota 2", steam=steam, download=download)["account"] == "other_acc"
    assert ("route", "steam") in events and ("preparing", ["█▀█"]) in events and events[-1] == ("completed", None)
    assert installed == [570]

    def unavailable(*_a, **_k):
        raise free_download.DepotUnavailable("no")
    events.clear()
    pipeline.depot_tool_download(args, "570", "Dota 2", steam=steam, download=unavailable)
    assert events[-1] == ("error", "steam_install")


def _manifest(library, app_id, flags, done=0, total=0, size=0):
    fields = {"appid": app_id, "name": "Dota 2", "installdir": "dota 2 beta", "StateFlags": flags,
              "SizeOnDisk": size, "BytesToDownload": total, "BytesDownloaded": done}
    body = "".join(f'\t"{key}"\t"{value}"\n' for key, value in fields.items())
    (library / f"appmanifest_{app_id}.acf").write_text('"AppState"\n{\n' + body + "}\n", encoding="utf-8")


def _steam_pipeline(tmp_path, on_install):
    from types import SimpleNamespace
    from game_download_manager.pipeline import DownloadPipeline
    events = []
    context = SimpleNamespace(logger=Log(), set_route=lambda r: events.append(("route", r)),
                              emit_progress=lambda app, phase, pct, **kw: events.append((phase, round(pct))),
                              emit_error=lambda app, msg, **kw: events.append(("error", msg)))
    steam = SimpleNamespace(root=tmp_path, libraries=lambda: [tmp_path], install=on_install)
    pipeline = DownloadPipeline.__new__(DownloadPipeline)
    pipeline.context = context
    return pipeline, steam, events, SimpleNamespace(download_source="steam-depot:570")


def test_a_free_steam_game_is_installed_by_steam_and_followed_in_its_manifest(tmp_path):
    asked = []
    pipeline, steam, events, args = _steam_pipeline(tmp_path, asked.append)
    states = iter([(1026, 0, 100), (1026, 50, 100), (4, 100, 100)])
    def sleep(_):
        flags, done, total = next(states)
        _manifest(tmp_path, 570, flags, done, total, size=100)
    result = pipeline.steam_depot(args, "570", "Dota 2", steam=steam, sleep=sleep, clock=lambda: 0.0)
    assert asked == [570]                       # Steam's own install window, no sign-in or QR of Game Access
    assert result["steam"] and result["size_bytes"] == 100
    assert ("downloading", 50) in events and events[-1] == ("completed", 100)


def test_steams_window_closed_without_installing_gives_up_with_steams_install(tmp_path):
    pipeline, steam, events, args = _steam_pipeline(tmp_path, lambda app: None)
    times = iter([0.0, 700.0])
    pipeline.steam_depot(args, "570", "Dota 2", steam=steam, sleep=lambda _: None, clock=lambda: next(times))
    assert events[-1] == ("error", "⟦dlSteamNotStarted⟧")


def test_an_already_installed_steam_game_is_done_without_opening_steam(tmp_path):
    asked = []
    pipeline, steam, events, args = _steam_pipeline(tmp_path, asked.append)
    _manifest(tmp_path, 570, 4, size=7)
    assert pipeline.steam_depot(args, "570", "Dota 2", steam=steam, sleep=lambda _: None)["size_bytes"] == 7
    assert asked == [] and events[-1] == ("completed", 100)
