"""Original smallest Digital archive retained and reapplied before Play."""
from __future__ import annotations
import contextlib
import io
import json
import os
import re
from pathlib import Path

class DigitalArchiveBackup:
    METADATA = ".digital-backup.json"

    @staticmethod
    def retain(archive, download_dir, extraction_dir, game_name, needs_password=False):
        root = Path(download_dir).resolve()
        source = Path(archive).resolve()
        destination = Path(extraction_dir).resolve()
        if not source.is_relative_to(root) or not destination.is_relative_to(root):
            raise RuntimeError("El respaldo debe permanecer en la carpeta descargada.")
        title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", game_name or root.name).strip(" .") or "game"
        # Keep all volumes when the smallest logical archive is multipart.
        part = re.match(r"^(.*?)(\.part\d+\.rar|\.\d{3})$", source.name, re.I)
        files = [source]
        if part:
            prefix = part.group(1)
            pattern = re.compile(re.escape(prefix) + (r"\.part\d+\.rar$" if ".part" in part.group(2).lower() else r"\.\d{3}$"), re.I)
            files = [p for p in source.parent.iterdir() if p.is_file() and pattern.fullmatch(p.name)]
            suffix = part.group(2)
        else:
            suffix = "".join(source.suffixes) if source.name.lower().endswith((".tar.gz", ".tar.bz2", ".tar.xz")) else source.suffix
        output = source.parent / f"{title}_backup{suffix}"
        moves = []
        for member in files:
            member_suffix = member.name[len(part.group(1)):] if part else suffix
            moves.append((member, member.parent / f"{title}_backup{member_suffix}"))
        if not part and source.suffix.lower() == ".zip":
            for member in source.parent.iterdir():
                if re.fullmatch(re.escape(source.stem) + r"\.z\d+", member.name, re.I):
                    moves.append((member, member.parent / f"{title}_backup{member.suffix}"))
        for member, target in moves:
            if member != target:
                os.replace(member, target)
        record = {"archive": str(output.relative_to(root)), "destination": str(destination.relative_to(root)),
                  "needs_password": bool(needs_password)}
        metadata = root / DigitalArchiveBackup.METADATA
        temporary = metadata.with_suffix(".tmp")
        temporary.write_text(json.dumps(record), encoding="utf-8")
        os.replace(temporary, metadata)
        return output

    @staticmethod
    def info(folder, name):
        root = Path(folder).resolve()
        metadata = root / DigitalArchiveBackup.METADATA
        if metadata.is_file():
            record = json.loads(metadata.read_text(encoding="utf-8"))
            archive = (root / record["archive"]).resolve()
            destination = (root / record["destination"]).resolve()
            if not archive.is_relative_to(root) or not destination.is_relative_to(root):
                raise RuntimeError("El respaldo apunta fuera de la carpeta Digital.")
            return {**record, "archive": archive, "destination": destination} if archive.is_file() else None
        # Support manually retained backups in existing downloads.
        title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
        backups = [p for p in root.rglob(f"{title}_backup.*") if p.is_file()
                   and not re.search(r"\.part(?!0*1\b)\d+\.rar$|\.(?!001\b)\d{3}$|\.z\d+$", p.name, re.I)]
        if len(backups) > 1:
            raise RuntimeError("Hay más de un respaldo para este juego.")
        return {"archive": backups[0], "destination": root, "needs_password": False} if backups else None

    @staticmethod
    def restore(folder, name, app_id, launcher):
        info = DigitalArchiveBackup.info(folder, name)
        if not info:
            return False
        import digital_downloader as worker
        worker.LAUNCHER_DIR = Path(launcher)
        worker.g_app_id = str(app_id)
        worker.g_cancelled.clear()
        # Native runner stdout must remain exactly one JSON result.
        original_emit = worker.emit_json
        try:
            worker.emit_json = lambda *_args, **_kwargs: None
            with contextlib.redirect_stdout(io.StringIO()):
                worker.extract_archives_in_path(str(info["archive"]), str(info["destination"]),
                    delete_archive=False, retain_backup=False)
        finally:
            worker.emit_json = original_emit
        return True
