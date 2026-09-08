import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
baseline = json.loads((root / "apps" / "desktop" / "quality-baseline.json").read_text(encoding="utf-8"))
sha = baseline["legacyBlobShas"]["src/LibraryRoom.tsx"]
blob = subprocess.check_output(["git", "cat-file", "blob", sha], cwd=root)
(root / "apps" / "desktop" / "src" / "LibraryRoom.tsx").write_bytes(blob)
print(f"Restored exact LibraryRoom legacy blob {sha}.")
