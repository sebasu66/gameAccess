"""Game-specific launch choices and reversible language repairs."""
from __future__ import annotations
import json
import re
import shutil
from pathlib import Path
from atomic_json import write_json
from .archives import ARCHIVE_SUFFIXES, checked_archive
from .launch import checked_executable, parse_arguments

LANGUAGES = {"spanish": ("es", "ES"), "english": ("en", "US"),
             "portuguese": ("pt", "BR"), "french": ("fr", "FR"), "german": ("de", "DE")}
LANGUAGE_KEY = re.compile(r"(?im)^([ \t]*(?:language|locale|gamelanguage|languageid)[ \t]*=[ \t]*)([\"']?)([a-zA-Z][a-zA-Z0-9_-]*)([\"']?)")

class DigitalGameOptions:
    def __init__(self, storage):
        self.storage = storage

    def path(self, app_id):
        return self.storage.launcher / ".cache" / "digital_launch" / f"{int(app_id)}.json"

    def load(self, app_id):
        path = self.path(app_id)
        saved = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        return {"executable": "", "arguments": "", "administrator": False, "language": "spanish",
                "backupEnabled": True, "backupArchive": "", **saved}

    def inspect(self, app_id, name):
        folder = self.storage.folder(app_id, name)
        executables = []
        if folder.is_dir():
            for candidate in folder.rglob("*.exe"):
                try:
                    checked_executable(folder, str(candidate.relative_to(folder)))
                    executables.append(str(candidate.relative_to(folder)))
                except ValueError:
                    continue
                if len(executables) >= 250:
                    break
        archives = []
        if folder.is_dir():
            for candidate in folder.rglob("*"):
                if candidate.is_file() and candidate.suffix.lower() in ARCHIVE_SUFFIXES and not candidate.is_symlink():
                    archives.append(str(candidate.relative_to(folder)))
                if len(archives) >= 100:
                    break
        return {"options": self.load(app_id), "executables": sorted(executables, key=str.lower),
                "archives": sorted(archives, key=str.lower), "folder": str(folder)}

    def save(self, app_id, name, values):
        options = self.load(app_id)
        options.update({key: values[key] for key in options if key in values})
        if (not isinstance(options["administrator"], bool) or options["language"] not in LANGUAGES
                or not isinstance(options["backupEnabled"], bool)):
            raise ValueError("Opciones de ejecución no válidas.")
        options["backupArchive"] = str(options["backupArchive"]).strip()
        if options["backupArchive"]:
            folder = self.storage.folder(app_id, name)
            options["backupArchive"] = str(checked_archive(folder, options["backupArchive"]).relative_to(folder))
        options["executable"] = str(options["executable"]).strip()
        options["arguments"] = str(options["arguments"]).strip()
        parse_arguments(options["arguments"])
        if options["executable"]:
            folder = self.storage.folder(app_id, name)
            options["executable"] = str(checked_executable(folder, options["executable"]).relative_to(folder))
        write_json(self.path(app_id), options)
        return options

def language_value(current, language, filename):
    short, region = LANGUAGES[language]
    if "-" in current:
        return short + "-" + region
    if "_" in current:
        return short + "_" + region
    if len(current) == 2 or "epic" in filename.lower():
        return short
    return language

def repair_language(folder, language, logger, known_only=False):
    if language not in LANGUAGES:
        raise ValueError("Idioma no compatible.")
    known = {"steam_api.ini", "steam_api64.ini", "steam_emu.ini", "onlinefix.ini", "flt.ini", "tenoke.ini", "rune.ini", "codex.ini", "ali213.ini", "plaza.ini", "epic_emu.ini", "language.ini", "goggame.ini", "anadius.ini", "cream_api.ini"}
    changes, errors = [], []
    if not folder.is_dir():
        raise ValueError("No existe la carpeta del juego.")
    for path in folder.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in (".ini", ".txt"):
            continue
        if known_only and path.suffix.lower() == ".ini" and path.name.lower() not in known:
            continue
        if path.suffix.lower() == ".txt" and path.name.lower() not in ("language.txt", "force_language.txt"):
            continue
        if not path.resolve().is_relative_to(folder.resolve()) or path.is_symlink():
            continue
        try:
            raw = path.read_bytes()
            encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "utf-8"
            try:
                text = raw.decode(encoding)
            except UnicodeDecodeError:
                encoding = "cp1251"
                text = raw.decode(encoding)
            if path.suffix.lower() == ".ini":
                updated = LANGUAGE_KEY.sub(lambda m: m[1] + m[2] + language_value(m[3], language, path.name) + m[4], text)
            else:
                token = text.strip()
                updated = text.replace(token, language_value(token, language, path.name), 1) if re.fullmatch(r"[A-Za-z_-]+", token) else text
            if updated == text:
                continue
            backup = path.with_name(path.name + ".gameaccess-language.bak")
            if not backup.exists():
                shutil.copy2(path, backup)
            path.write_bytes(updated.encode(encoding))
            changes.append(str(path.relative_to(folder)))
            logger.info("Language repair: %s -> %s; original backup=%s", path, language, backup)
        except (OSError, UnicodeError) as error:
            errors.append({"file": str(path.relative_to(folder)), "error": str(error)})
            logger.warning("Language repair failed: %s: %s", path, error)
    return {"changed": changes, "errors": errors}

