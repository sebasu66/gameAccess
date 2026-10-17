"""Optional local execution profiles supplied by plugins or the user's form."""
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from atomic_json import write_json
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
    decompress_file = value.get("decompressFile", "")
    if not isinstance(decompress_file, str) or len(decompress_file) > 512 or ".." in Path(decompress_file).parts or Path(decompress_file).is_absolute():
        raise ValueError("El archivo a descomprimir debe ser una ruta dentro de la carpeta del juego.")
    patterns = value.get("executablePatterns", [])
    if not isinstance(patterns, list) or len(patterns) > 32 or any(not isinstance(p, str) or not p.strip() or len(p) > 260 or re.search(r"[\\/:]|\.\.", p) for p in patterns):
        raise ValueError("Los archivos a probar deben ser nombres o patrones como GAME.EXE o *LAUNCHER*.EXE.")
    setup_pattern = value.get("setupPattern", "")
    if not isinstance(setup_pattern, str) or len(setup_pattern) > 260 or re.search(r"[\\/:]|\.\.", setup_pattern):
        raise ValueError("El patrón del instalador debe ser un nombre como setup*.exe.")
    setup_args = value.get("setupArguments", [])
    if not isinstance(setup_args, list) or len(setup_args) > 32 or any(not isinstance(a, str) or len(a) > 260 or re.search(r"[\r\n\x00]", a) for a in setup_args):
        raise ValueError("Los argumentos del instalador deben ser una lista de texto.")
    if "runSetup" in value and value["runSetup"] is not None and not isinstance(value["runSetup"], bool):
        raise ValueError("El campo runSetup debe ser verdadero, falso o vacío.")
    for flag in ("decompressEachRun", "runAsAdmin"):
        if flag in value and not isinstance(value[flag], bool):
            raise ValueError(f"El campo {flag} debe ser verdadero o falso.")
    return {**value, "version": 1, "archivePasswords": passwords, "beforePlay": steps,
            "decompressEachRun": bool(value.get("decompressEachRun", False)), "decompressFile": decompress_file.strip(),
            "executablePatterns": [p.strip() for p in patterns], "runAsAdmin": bool(value.get("runAsAdmin", False)),
            "runSetup": value.get("runSetup"), "setupPattern": setup_pattern.strip(), "setupArguments": setup_args}

def load_profile(launcher, app_id):
    path = profile_path(launcher, app_id)
    if not path.is_file():
        return validate_profile({})
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


def save_profile(launcher, app_id, profile):
    """Validate and write the profile atomically (the form and plugins share this file)."""
    clean = validate_profile(profile)
    write_json(profile_path(launcher, app_id), clean)
    return clean

def executable_matches(path, patterns):
    """Candidates whose file name matches one of the profile patterns, in pattern order (case-insensitive)."""
    from fnmatch import fnmatch
    ordered = []
    for pattern in patterns:
        for candidate in path:
            if fnmatch(Path(candidate).name.lower(), pattern.lower()) and candidate not in ordered:
                ordered.append(candidate)
    return ordered

def declared_fix_archive(profile):
    """The archive name a profile declares as the fix, or '' (nothing is then retained)."""
    return profile.get("decompressFile", "") if profile.get("decompressEachRun") else ""
