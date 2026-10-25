"""Encode generated image assets and publish to GitHub before syncing locally."""
import argparse
import base64
import io
import json
import subprocess
import tempfile
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--generated-root", type=Path, required=True)
parser.add_argument("--branch", required=True)
parser.add_argument("--expected-sha", required=True)
parser.add_argument("--base-filename", required=True)
parser.add_argument("--plus-filename", required=True)
args = parser.parse_args()
repo = "repos/sebasu66/gameAccess"

def api(endpoint, payload=None):
    command = ["gh", "api", f"{repo}/{endpoint}"]
    with tempfile.TemporaryDirectory(prefix="ga-entry-publish-") as temp:
        if payload is not None:
            request = Path(temp) / "request.json"
            request.write_text(json.dumps(payload), encoding="utf-8")
            command += ["--method", "POST", "--input", str(request)]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

ref = api(f"git/ref/heads/{args.branch}")["object"]["sha"]
if ref != args.expected_sha:
    raise SystemExit("Remote branch moved; inspect before publishing")
tree_sha = api(f"git/commits/{ref}")["tree"]["sha"]
sources = [
    (args.base_filename, "access-ticket-base.webp"),
    (args.plus_filename, "access-ticket-plus.webp"),
]
entries = []
for filename, asset in sources:
    image = Image.open(args.generated_root / filename)
    # Only encode the existing art: preserve size, composition and alpha.
    encoded = io.BytesIO()
    image.save(encoded, format="WEBP", quality=90, method=6)
    data = encoded.getvalue()
    blob = api("git/blobs", {"content": base64.b64encode(data).decode("ascii"), "encoding": "base64"})
    entries.append({"path": f"apps/desktop/public/brand/{asset}", "mode": "100644",
                    "type": "blob", "sha": blob["sha"]})
    print(f"Uploaded {asset}: {len(data)} bytes, {image.size}, {image.mode}", flush=True)
tree = api("git/trees", {"base_tree": tree_sha, "tree": entries})
commit = api("git/commits", {"message": "Add cinematic entry world and matching BASE/PLUS ticket art",
                           "tree": tree["sha"], "parents": [ref]})
if api(f"git/ref/heads/{args.branch}")["object"]["sha"] != ref:
    raise SystemExit("Remote moved; generated commit retained without updating the branch")
subprocess.run(["gh", "api", f"{repo}/git/refs/heads/{args.branch}", "--method", "PATCH",
                "-f", f"sha={commit['sha']}", "-F", "force=false"],
               check=True, capture_output=True, text=True)
print(f"Published commit {commit['sha']}", flush=True)
