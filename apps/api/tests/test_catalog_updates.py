"""Update batches are built from the git history of the published packages and served from GitHub."""
import gzip
import hashlib
import json
import subprocess
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import discovery_service as service
from app.catalog_snapshot import write_snapshot
from app.catalog_updates import published_packages, publish_updates


def _game(app_id, name):
    return (app_id, app_id, json.dumps({"id": app_id, "app_id": app_id, "name": name}))


def _git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def _publish(repo, out, rows, message):
    write_snapshot(rows, {}, out, "dev")
    for old in out.glob("catalog-cache-*.sqlite.gz"):   # the job keeps only the current package in the branch
        if old.name != f"catalog-cache-{json.loads((out / 'catalog-manifest.json').read_text())['revision']}.sqlite.gz":
            old.unlink()
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", message)
    return json.loads((out / "catalog-manifest.json").read_text())["revision"]


def test_batches_from_the_last_revisions_are_published_and_served_from_github(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    out = repo / "deploy" / "catalog-cache"
    out.mkdir(parents=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    first = _publish(repo, out, [_game(10, "A")], "one")
    second = _publish(repo, out, [_game(10, "A"), _game(20, "B")], "two")
    write_snapshot([_game(10, "A renamed"), _game(20, "B"), _game(30, "C")], {}, out, "dev")
    third = json.loads((out / "catalog-manifest.json").read_text())["revision"]

    work = tmp_path / "history"
    work.mkdir()
    bases = published_packages(out, work, third)
    assert [revision for revision, _ in bases] == [second, first]
    updates = publish_updates(out, bases, "dev")

    manifest = json.loads((out / "catalog-manifest.json").read_text())
    assert set(manifest["updates"]) == {first, second}
    for base, expected in ((second, [10, 30]), (first, [10, 20, 30])):
        entry = updates[base]
        assert entry["artifact_url"] == f"https://raw.githubusercontent.com/sebasu66/gameAccess/refs/heads/dev/deploy/catalog-cache/catalog-update-{base}-{third}.json.gz"
        data = (out / f"catalog-update-{base}-{third}.json.gz").read_bytes()
        assert hashlib.sha256(data).hexdigest() == entry["sha256"]
        batch = json.loads(gzip.decompress(data))
        assert batch["base_revision"] == base and batch["revision"] == third
        assert sorted(game["app_id"] for game in batch["games"]) == expected

    # The server answers with the GitHub file for each case; it never serves catalog bytes itself.
    monkeypatch.setattr(service, "ROOT", out)
    monkeypatch.setattr(service, "_cached_revision", "")
    app = FastAPI()
    app.include_router(service.router)
    client = TestClient(app)
    delta = client.get("/library/catalog/manifest", params={"since": second}).json()
    assert delta["kind"] == "delta" and delta["base_revision"] == second
    assert delta["artifact_url"] == updates[second]["artifact_url"] and delta["sha256"] == updates[second]["sha256"]
    assert "updates" not in delta
    for since in ("", "0123456789abcdef", third):
        baseline = client.get("/library/catalog/manifest", params={"since": since}).json()
        assert baseline["kind"] == "baseline"
        assert baseline["artifact_url"] == manifest["artifact_url"]
        assert baseline["artifact_url"].startswith("https://raw.githubusercontent.com/")


def test_without_git_history_there_are_no_batches_and_clients_get_the_package(tmp_path):
    write_snapshot([_game(10, "A")], {}, tmp_path, "dev")
    revision = json.loads((tmp_path / "catalog-manifest.json").read_text())["revision"]
    assert published_packages(tmp_path, tmp_path, revision) == []
    assert publish_updates(tmp_path, [], "dev") == {}
    assert json.loads((tmp_path / "catalog-manifest.json").read_text())["updates"] == {}
