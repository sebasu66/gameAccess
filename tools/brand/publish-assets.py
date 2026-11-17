"""Publish generated binary assets to GitHub first, without modifying local source."""
import argparse
import base64
import json
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--assets", type=Path, required=True)
parser.add_argument("--branch", required=True)
parser.add_argument("--expected-sha", required=True)
args = parser.parse_args()
repo = "repos/sebasu66/gameAccess"

def api(endpoint, payload=None):
    command = ["gh", "api", f"{repo}/{endpoint}"]
    with tempfile.TemporaryDirectory(prefix="ga-brand-publish-") as temp:
        if payload is not None:
            request = Path(temp) / "request.json"
            request.write_text(json.dumps(payload), encoding="utf-8")
            command += ["--method", "POST", "--input", str(request)]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

ref = api(f"git/ref/heads/{args.branch}")["object"]["sha"]
if ref != args.expected_sha:
    raise SystemExit("Remote branch moved; inspect it before publishing")
base_tree = api(f"git/commits/{ref}")["tree"]["sha"]
entries = []
names = ["logo-entry-loop.webm", "logo-entry-poster.png", "logo-header-loop.webm",
         "logo-header-poster.png", "logo-intro.webm", "logo-to-header.webm"]
for name in names:
    content = base64.b64encode((args.assets / name).read_bytes()).decode("ascii")
    blob = api("git/blobs", {"content": content, "encoding": "base64"})
    entries.append({"path": f"apps/desktop/public/brand/{name}", "mode": "100644",
                    "type": "blob", "sha": blob["sha"]})
    print(f"Uploaded {name}", flush=True)
tree = api("git/trees", {"base_tree": base_tree, "tree": entries})
commit = api("git/commits", {"message": "Record sharper G/A films with stable camera depth",
                           "tree": tree["sha"], "parents": [ref]})
# PATCH has separate method handling to preserve GitHub's non-force ref update.
if api(f"git/ref/heads/{args.branch}")["object"]["sha"] != ref:
    raise SystemExit("Remote branch moved; generated commit retained without changing the branch")
subprocess.run(["gh", "api", f"{repo}/git/refs/heads/{args.branch}", "--method", "PATCH",
                "-f", f"sha={commit['sha']}", "-F", "force=false"],
               check=True, capture_output=True, text=True)
print(f"Published commit {commit['sha']}", flush=True)
