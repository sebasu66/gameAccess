"""Game-specific launch choices and reversible language repairs."""
from __future__ import annotations
import json
import os
import re
import shutil
from pathlib import Path
from atomic_json import write_json
from launcher_data import data_dir
from .archives import ARCHIVE_SUFFIXES, checked_archive
from .launch import checked_executable, parse_arguments
from .runtimes import REDIST_DIRS

LANGUAGES = {"spanish": ("es", "ES"), "english": ("en", "US"),
             "portuguese": ("pt", "BR"), "french": ("fr", "FR"), "german": ("de", "DE")}
APP_LANGUAGE_ENV = "GAMEACCESS_APP_LANGUAGE"
LANGUAGE_KEY = re.compile(r"(?im)^([ \t]*(?:language|locale|gamelanguage|languageid)[ \t]*=[ \t]*)([\"']?)([a-zA-Z][a-zA-Z0-9_-]*)([\"']?)")

class DigitalGameOptions:
    def __init__(self, storage):
        self.storage = storage

    def path(self, app_id):
        return data_dir(self.storage.launcher) / ".cache" / "digital_launch" / f"{int(app_id)}.json"

    def load(self, app_id):
        path = self.path(app_id)
        saved = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        # "" = follow the application's language (see effective_language); a game can still pin its own.
        return {"executable": "", "arguments": "", "administrator": False, "language": "",
                "backupEnabled": True, "backupArchive": "", **saved}

    def inspect(self, app_id, name):
        folder = self.storage.folder(app_id, name)
        executables = []
        if folder.is_dir():
            for candidate in folder.rglob("*.exe"):
                # The redistributables the game ships (_CommonRedist, DirectX...) are never the game: not offered.
                if any(REDIST_DIRS.match(part) for part in candidate.relative_to(folder).parts[:-1]):
                    continue
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
        if (not isinstance(options["administrator"], bool) or (options["language"] and options["language"] not in LANGUAGES and options["language"] != KEEP_LANGUAGE)
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

KEEP_LANGUAGE = "keep"  # the player's choice: never touch the game's language settings

def effective_language(options):
    """The game's own choice, else the language the desktop app runs in (passed by the app), else Spanish."""
    chosen = options.get("language") or ""
    if chosen in LANGUAGES or chosen == KEEP_LANGUAGE:
        return chosen
    app = os.environ.get(APP_LANGUAGE_ENV, "").strip().lower()
    return app if app in LANGUAGES else "spanish"

_LANGUAGE_NAMES = {
    "spanish": r"spanish|espa[nñ]ol|castellano|latam|es[-_](?:es|mx|ar|419|la)|es|spa|esn",
    "english": r"english|en|eng",
    "portuguese": r"portuguese|portugu[eê]s|pt[-_](?:br|pt)|pt|por|ptb",
    "french": r"french|fran[cç]ais|fr[-_](?:fr|ca)|fr|fra",
    "german": r"german|deutsch|de[-_](?:de|at)|de|ger|deu",
}

def supports_language(folder, language, limit=6000):
    """Whether the game ships files for `language` (a folder or file named for it, like Spanish/ or text_es.pak). Used
    before the app's own language is forced into a game's settings: forcing one the game lacks keeps it from opening
    (a game set to Spanish that has no Spanish). English is assumed. A game whose texts sit inside packed archives shows
    nothing here, so it is left as its fix has it; the player can still pin a language for it in its options."""
    if language == "english":
        return True
    names = _LANGUAGE_NAMES.get(language)
    if not names:
        return False
    token = re.compile(rf"(?<![a-z])(?:{names})(?![a-z])")
    root = Path(folder)
    seen = 0
    for path in root.rglob("*"):
        seen += 1
        if seen > limit:
            break
        try:
            depth = len(path.relative_to(root).parts)
        except ValueError:
            continue
        if depth > 6:
            continue
        stem = path.stem.lower() if path.is_file() else path.name.lower()
        if token.search(stem) and (path.is_dir() or path.suffix.lower() not in (".exe", ".dll")):
            return True
    return False

def restore_language(folder, logger=None):
    """Puts back every settings file a language repair changed (it saved the original next to it)."""
    restored = []
    for backup in Path(folder).rglob("*.gameaccess-language.bak"):
        target = backup.with_name(backup.name[: -len(".gameaccess-language.bak")])
        try:
            shutil.copy2(backup, target)
            backup.unlink()
            restored.append(str(target.relative_to(folder)))
            if logger:
                logger.info("Language restored from backup: %s", target)
        except OSError as error:
            if logger:
                logger.warning("Language restore failed: %s: %s", target, error)
    return restored

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

