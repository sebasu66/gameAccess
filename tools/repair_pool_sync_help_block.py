from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
path = root / "apps/launcher/pool_sync.py"
text = path.read_text(encoding="utf-8")
pattern = re.compile(
    r'        help=\(.*?refuse backend sync unless every provider has verified .*?SteamKit ownership.*?\),',
    re.DOTALL,
)
replacement = '''        help=(
            "refuse backend sync unless every provider has verified "
            "SteamKit ownership"
        ),'''
updated, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise RuntimeError(f"Expected one malformed help block, found {count}")
path.write_text(updated, encoding="utf-8", newline="\n")
print("POOL_HELP_REPAIRED")
Path(__file__).unlink()
