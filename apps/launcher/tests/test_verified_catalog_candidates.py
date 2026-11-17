"""Current metadata candidates use canonical AppIDs, independently of ownership."""
from pathlib import Path
import steam_appinfo


def test_requested_metadata_candidate_does_not_require_an_account_or_license(tmp_path, monkeypatch):
    path = tmp_path / "appinfo.vdf"
    path.write_bytes(b"fixture")
    monkeypatch.setattr(steam_appinfo, "iter_appinfo", lambda _: iter([
        {"app_id":1091500, "name":"Cyberpunk 2077", "type":"game", "launch":[]},
        {"app_id":10, "name":"Other", "type":"game", "launch":[]},
    ]))
    catalog = steam_appinfo.read_local_app_catalog(path, {1091500})
    assert list(catalog) == [1091500]
    assert catalog[1091500]["name"] == "Cyberpunk 2077"
    assert not list(tmp_path.glob("**/loginusers.vdf"))
    assert not any(field in catalog[1091500] for field in ("accounts","licenses","provider_id"))


def test_candidate_identity_is_exact_instead_of_title_similarity(tmp_path, monkeypatch):
    path = tmp_path / "appinfo.vdf"
    path.write_bytes(b"fixture")
    monkeypatch.setattr(steam_appinfo, "iter_appinfo", lambda _: iter([
        {"app_id":11, "name":"Same title", "type":"game"},
        {"app_id":12, "name":"Same title", "type":"game"},
    ]))
    assert list(steam_appinfo.read_local_app_catalog(path, {12})) == [12]
