from pathlib import Path
import subprocess
root = Path(__file__).resolve().parent
result = subprocess.run(["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(root / "start.ps1")], cwd=str(root.parent.parent))
raise SystemExit(result.returncode)
