"""Validate and publish only generated discovery data from a synchronized checkout."""
import argparse
import gzip
import hashlib
import json
import sqlite3
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--branch", required=True)
    parser.add_argument("--expected-head", required=True)
    args = parser.parse_args()
    if git("branch", "--show-current") != args.branch or git("rev-parse", "HEAD") != args.expected_head:
        raise SystemExit("Checkout is not the requested pushed commit.")
    git("fetch", "origin", args.branch)
    if git("rev-parse", "FETCH_HEAD") != args.expected_head:
        raise SystemExit("Remote changed; synchronize before publishing.")
    directory = ROOT / "deploy/catalog-cache"
    manifest = json.loads((directory / "catalog-manifest.json").read_text(encoding="utf-8"))
    if not manifest.get("generated_at") or not manifest.get("coverage", {}).get("recent_complete"):
        raise SystemExit("Snapshot lacks complete recent coverage or generation timestamp.")
    package = directory / ("catalog-cache-" + manifest["revision"] + ".sqlite.gz")
    payload = package.read_bytes()
    if hashlib.sha256(payload).hexdigest() != manifest["sha256"]:
        raise SystemExit("Snapshot hash mismatch.")
    database = sqlite3.connect(":memory:")
    database.deserialize(gzip.decompress(payload))
    if database.execute("SELECT count(*) FROM catalog_game").fetchone()[0] != manifest["catalog_count"]:
        raise SystemExit("Snapshot count mismatch.")
    if database.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0] != manifest["revision"]:
        raise SystemExit("Snapshot revision mismatch.")
    database.close()
    if git("diff", "--cached", "--name-only"):
        raise SystemExit("Existing staged user changes; refusing to include them.")
    git("add", "--", "deploy/catalog-cache")
    if not git("diff", "--cached", "--name-only"):
        print("Discovery seed already published.")
        return
    git("-c", "user.name=GameAccess catalog updater", "-c", "user.email=catalog-updater@users.noreply.github.com",
        "commit", "-m", "Bundle verified Steam discovery database with recent releases")
    git("push", "origin", "HEAD:" + args.branch)
    print(json.dumps({"commit":git("rev-parse", "HEAD"),"catalog_count":manifest["catalog_count"],"sha256":manifest["sha256"]}))
if __name__ == "__main__":
    main()
