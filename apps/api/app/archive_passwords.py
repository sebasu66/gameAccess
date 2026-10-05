"""Central archive password storage, managed only by the server administrator."""
import os
from pathlib import Path
import tempfile

def archive_password_path():
    return Path(os.environ.get("GAMEACCESS_ARCHIVE_PASSWORD_FILE", str(Path(__file__).resolve().parents[1] / "data" / "contraseñas_zip")))

def read_archive_passwords():
    path = archive_password_path()
    if not path.exists():
        return []
    return list(dict.fromkeys(line for line in path.read_text(encoding="utf-8-sig").splitlines() if line))

def save_archive_passwords(text):
    lines = list(dict.fromkeys(line for line in text.splitlines() if line))
    if len(lines) > 5000 or any(len(line) > 1024 for line in lines):
        raise ValueError("Máximo 5000 contraseñas de hasta 1024 caracteres.")
    path = archive_password_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write("\n".join(lines) + ("\n" if lines else ""))
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return lines
