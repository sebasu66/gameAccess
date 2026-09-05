from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "apps" / "launcher" / "provider_download_manager.py"


def main() -> int:
    text = TARGET.read_text(encoding="utf-8")
    pattern = r'handle\.write\(json\.dumps\(entry, ensure_ascii=True\) \+ "\s*"\)'
    replacement = 'handle.write(json.dumps(entry, ensure_ascii=True) + "\\n")'
    fixed, count = re.subn(pattern, lambda _: replacement, text, count=1)
    if count != 1:
        raise RuntimeError(f"Expected exactly one broken logger string, found {count}")

    compile(fixed, str(TARGET), "exec")
    TARGET.write_text(fixed, encoding="utf-8", newline="\n")

    subprocess.run(["git", "add", "--", str(TARGET.relative_to(ROOT))], cwd=ROOT, check=True)
    subprocess.run(
        ["git", "commit", "-m", "fix(download): repair persistent logger syntax"],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(["git", "push", "origin", "main"], cwd=ROOT, check=True)
    print(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
