"""Optional local execution profiles supplied by plugins or the user's form."""
import json
import logging
import os
import re
import subprocess
from pathlib import Path
LOG = logging.getLogger("DigitalExecution")

def profile_path(launcher, app_id):
    return Path(launcher) / ".cache" / "execution_profiles" / f"{int(app_id)}.json"

def validate_profile(value):
    if not isinstance(value, dict):
        raise ValueError("El perfil debe ser un objeto JSON.")
    passwords = value.get("archivePasswords", [])
    steps = value.get("beforePlay", [])
    if not isinstance(passwords, list) or len(passwords) > 5000 or any(not isinstance(p, str) or len(p) > 1024 for p in passwords):
        raise ValueError("Lista de contraseñas inválida.")
    if not isinstance(steps, list) or len(steps) > 32:
        raise ValueError("Máximo 32 pasos de preparación.")
    for step in steps:
        if not isinstance(step, dict) or step.get("type") not in ("ini-set", "run"):
            raise ValueError("Operación de perfil no soportada.")
        if step["type"] == "run" and (not isinstance(step.get("arguments", []), list) or any(not isinstance(arg, str) for arg in step.get("arguments", []))):
            raise ValueError("Los argumentos del ejecutable deben ser una lista.")
    return {**value, "version": 1, "archivePasswords": passwords, "beforePlay": steps}

def load_profile(launcher, app_id):
    path = profile_path(launcher, app_id)
    if not path.is_file():
        return {"version": 1, "archivePasswords": [], "beforePlay": []}
    return validate_profile(json.loads(path.read_text(encoding="utf-8-sig")))

def apply_before_play(folder, profile):
    root = Path(folder).resolve()
    for step in validate_profile(profile)["beforePlay"]:
        if step["type"] == "ini-set":
            pattern = step.get("glob", "*.ini")
            if not isinstance(pattern, str) or ".." in pattern or Path(pattern).is_absolute():
                raise ValueError("Ruta de perfil fuera de la carpeta del juego.")
            section, key, value = (step.get(k, "") for k in ("section", "key", "value"))
            if not all(isinstance(v, str) and "\n" not in v and "\r" not in v for v in (section, key, value)) or not section or not key:
                raise ValueError("Configuración INI inválida.")
            for file in root.rglob(pattern):
                if not file.resolve().is_relative_to(root) or not file.is_file():
                    raise ValueError("Ruta de perfil fuera de la carpeta del juego.")
                content = file.read_text(encoding="utf-8", errors="ignore")
                marker = "[" + section + "]"
                match = re.search(r"(?im)^" + re.escape(marker) + r"\s*$", content)
                if not match:
                    continue
                start = match.end()
                end_match = re.search(r"(?m)^\[", content[start:])
                end = start + end_match.start() if end_match else len(content)
                body = content[start:end]
                entry = re.compile(r"(?im)^" + re.escape(key) + r"\s*=.*$")
                changed = entry.sub(lambda _: key + "=" + value, body) if entry.search(body) else "\n" + key + "=" + value + body
                updated = content[:start] + changed + content[end:]
                if updated != content:
                    file.write_text(updated, encoding="utf-8")
                    LOG.info("Profile preparation: INI updated %s", file.relative_to(root))
        else:
            executable = (root / str(step.get("executable", ""))).resolve()
            if not executable.is_relative_to(root) or not executable.is_file() or executable.suffix.lower() != ".exe":
                raise ValueError("Selecciona un ejecutable del juego para el paso de preparación.")
            LOG.info("Profile preparation: starting %s", executable.relative_to(root))
            subprocess.run([str(executable), *step.get("arguments", [])], cwd=executable.parent, shell=False, check=True, timeout=60)
            LOG.info("Profile preparation: process completed")
