"""Archive discovery, extraction and existing backup/cleanup policy."""
from __future__ import annotations
from game_execution_manager.archives import is_backup_name, is_secondary_volume
import os
import re
import shutil
import subprocess
from typing import Optional

ARCHIVE_EXTENSIONS = (
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz",
    ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz",
    ".iso", ".z01", ".part1.rar", ".001"
)

def find_portable_7z() -> Optional[str]:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "bin", "7z", "7z.exe"),
        os.path.join(base_dir, "bin", "7z.exe"),
        os.path.join(base_dir, "7z.exe"),
        os.path.expanduser(r"~\scoop\shims\7z.exe"),
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return os.path.abspath(path)
    for cmd in ["7z", "7za", "7z.exe"]:
        found = shutil.which(cmd)
        if found:
            return os.path.abspath(found)
    return None

def is_archive(filename: str) -> bool:
    fn = filename.lower()
    return any(fn.endswith(ext) for ext in ARCHIVE_EXTENSIONS)

def delete_archive_and_parts(archive_path: str):
    dir_name = os.path.dirname(archive_path) or "."
    base_name = os.path.basename(archive_path)

    if os.path.exists(archive_path):
        try:
            os.remove(archive_path)
        except Exception:
            pass

    m_part = re.match(r"^(.*?)\.part\d+\.rar$", base_name, re.IGNORECASE)
    if m_part:
        prefix = m_part.group(1).lower()
        for f in os.listdir(dir_name):
            if re.match(rf"^{re.escape(prefix)}\.part\d+\.rar$", f, re.IGNORECASE):
                p = os.path.join(dir_name, f)
                try: os.remove(p)
                except Exception: pass

    m_num = re.match(r"^(.*?)\.\d{3}$", base_name, re.IGNORECASE)
    if m_num:
        prefix = m_num.group(1).lower()
        for f in os.listdir(dir_name):
            if re.match(rf"^{re.escape(prefix)}\.\d{{3}}$", f, re.IGNORECASE):
                p = os.path.join(dir_name, f)
                try: os.remove(p)
                except Exception: pass

    m_zip = re.match(r"^(.*?)\.zip$", base_name, re.IGNORECASE)
    if m_zip:
        prefix = m_zip.group(1).lower()
        for f in os.listdir(dir_name):
            if re.match(rf"^{re.escape(prefix)}\.z\d+$", f, re.IGNORECASE):
                p = os.path.join(dir_name, f)
                try: os.remove(p)
                except Exception: pass


def archive_member_names(archive: str, seven_zip: Optional[str], password: str) -> Optional[list[str]]:
    """List incoming payload files without extracting or prompting."""
    import zipfile
    import tarfile
    names = []
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as zf:
            names = [entry.filename for entry in zf.infolist() if not entry.is_dir()]
    elif tarfile.is_tarfile(archive):
        with tarfile.open(archive) as tf:
            names = [entry.name for entry in tf.getmembers() if entry.isfile()]
    elif seven_zip:
        listed = subprocess.run(
            [seven_zip, "l", "-slt", "-ba", os.path.abspath(archive), f"-p{password}"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=30,
            **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {})
        )
        if listed.returncode:
            # An encrypted header will be listed again with the next password.
            return None
        for block in re.split(r"\n\s*\n", listed.stdout):
            fields = dict(line.split(" = ", 1) for line in block.splitlines() if " = " in line)
            if "Path" in fields and fields.get("Folder") != "+" and not fields.get("Attributes", "").startswith("D"):
                names.append(fields["Path"])
    return names


class ArchiveExtractor:
    def __init__(self, context):
        self.context = context

    def request_archive_passwords(self):
        """Use only the local user/plugin profile; never contact the central server."""
        context = self.context
        from game_execution_manager.execution_profile import load_profile
        passwords = load_profile(context.launcher_dir, context.app_id)["archivePasswords"]
        context.logger.info("AppID %s: archive extraction using optional local profile; credentials are not logged", context.app_id)
        if not passwords:
            raise RuntimeError("El archivo requiere contraseña. Añade un perfil o contraseña en las opciones de descarga.")
        return list(dict.fromkeys(p for p in passwords if p))


    def archive_enclosing_folder(self, archive: str, seven_zip: Optional[str], password: str) -> Optional[str]:
        """Return the one enclosing folder, or an empty string for loose contents."""
        context = self.context
        names = context.archive_member_names(archive, seven_zip, password)
        if names is None:
            context.logger.warning(f"No se pudieron leer los archivos dentro de {os.path.basename(archive)}")
            return None
        if not names:
            return ""
        parts = [name.replace("\\", "/").strip("/").split("/") for name in names]
        if any(".." in path or path[0].endswith(":") for path in parts):
            raise RuntimeError("El archivo contiene rutas fuera de la carpeta del juego.")
        first = parts[0][0]
        is_hoisted = all(len(path) > 1 and path[0] == first for path in parts)

        if is_hoisted:
            context.logger.debug(f"Smart Hoisting: ZIP contiene una única carpeta raíz '{first}'. Extrayendo directo al destino.")
            return first
        else:
            context.logger.debug("Smart Hoisting: ZIP contiene archivos sueltos. No se ajustará la ruta de extracción.")
            return ""


    def extract_archives_in_path(self,
        target_path: str,
        dest_dir: str,
        host: Optional[str] = None,
        password: Optional[str] = None,
        delete_archive: bool = True,
        game_name: Optional[str] = None,
        retain_backup: bool = True,
        source_root: Optional[str] = None,
        auto_installed: bool = False
    ) -> bool:
        """
        Extracts archive files (or archives found inside target directory) using portable 7-Zip,
        with Python zipfile/tarfile fallback.
        If delete_archive is True, removes original compressed archive(s) and volume parts.
        """
        context = self.context
        context.logger.debug("Extraction entered: input=%s destination=%s auto_installed=%s", target_path, dest_dir, auto_installed)
        archives_to_extract = []

        if os.path.isfile(target_path) and is_archive(target_path):
            archives_to_extract.append(target_path)
        elif os.path.isdir(target_path):
            for root, _, files in os.walk(target_path):
                for f in files:
                    full_path = os.path.join(root, f)
                    if is_archive(full_path):
                        if is_backup_name(f) or is_secondary_volume(f):
                            continue
                        archives_to_extract.append(full_path)

        if not archives_to_extract:
            return False

        # Treat multipart volumes as one archive; only their first volume is extracted.
        # Only the fix archive declared by the execution profile is retained (and re-applied on
        # every Play). Without a declaration nothing is kept, so a full game is never backed up.
        fix_name = ""
        if not auto_installed and retain_backup:
            try:
                from game_execution_manager.execution_profile import load_profile, declared_fix_archive
                fix_name = os.path.basename(declared_fix_archive(load_profile(context.launcher_dir, context.app_id))).lower()
            except Exception as error:
                context.logger.warning("AppID %s: no se pudo leer el perfil para el respaldo: %s", context.app_id, error)
        is_fix = lambda path: bool(fix_name) and os.path.basename(path).lower() == fix_name
        if not auto_installed:
            archives_to_extract.sort(key=lambda path: (is_fix(path), -os.path.getsize(path), path.lower()))
            context.logger.debug(f"Modo normal: {len(archives_to_extract)} archivos por tamaño descendente; el fix declarado ({fix_name or 'ninguno'}) va al final.")
        else:
            context.logger.debug(f"Modo auto_installed: Se respeta el orden natural de {len(archives_to_extract)} archivos.")

        game_subfolder = os.path.abspath(dest_dir)
        seven_zip = context.find_portable_7z()

        # Determine password
        effective_password = password
        passwords = [effective_password] if effective_password else ["-"]
        profile_passwords_loaded = False

        total = len(archives_to_extract)
        for idx, arc in enumerate(archives_to_extract):
            arc_name = os.path.basename(arc)
            context.logger.info(f"Iniciando extracción de: {arc_name} ({idx+1}/{total})")
            context.emit_progress(
                app_id=context.app_id,
                phase="decompressing",
                progress_percent=round((idx / total) * 100.0, 1),
                status_text=f"Organizando archivos de {arc_name} ({idx+1}/{total})..."
            )

            success = False
            if seven_zip:
                attempt = 0
                while attempt < len(passwords):
                    candidate_password = passwords[attempt]
                    if attempt:
                        context.emit_progress(
                            app_id=context.app_id, phase="decompressing",
                            progress_percent=(idx / total) * 100,
                            status_text=f"Probando contraseña {attempt+1}/{len(passwords)} para {arc_name}..."
                        )
                    enclosing = context.archive_enclosing_folder(arc, seven_zip, candidate_password)
                    extraction_dir = game_subfolder if not auto_installed and idx == total - 1 and total > 1 and enclosing == "" else os.path.abspath(dest_dir)
                    if not auto_installed and enclosing and idx == 0 and total > 1:
                        game_subfolder = os.path.join(os.path.abspath(dest_dir), enclosing)
                    cmd = [
                        seven_zip, "x", os.path.abspath(arc),
                        f"-o{extraction_dir}", "-y", "-aos" if auto_installed else "-aoa",
                        "-bsp1", "-bso1", "-bse1",
                        f"-p{candidate_password}",
                    ]
                    # Never allow a hidden password prompt to wait forever.

                    context.active_subprocess = subprocess.Popen(
                        cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                        **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {})
                    )
                    output_tail = ""
                    token = ""
                    last_percent = -1
                    while True:
                        character = context.active_subprocess.stdout.read(1)
                        if not character:
                            break
                        output_tail = (output_tail + character)[-2000:]
                        token = (token + character)[-100:]
                        if character == "%":
                            match = re.search(r"(\d{1,3})%$", token)
                            if match:
                                percent = min(int(match.group(1)), 100)
                                if percent != last_percent:
                                    last_percent = percent
                                    context.emit_progress(
                                        app_id=context.app_id, phase="decompressing",
                                        progress_percent=((idx + percent / 100) / total) * 100,
                                        status_text=f"Descomprimiendo {arc_name} ({idx+1}/{total}) · {percent}%"
                                    )
                        if character in "\r\n":
                            token = ""
                    context.active_subprocess.stdout.close()
                    returncode = context.active_subprocess.wait()
                    context.active_subprocess = None
                    if context.cancelled.is_set():
                        return False
                    if returncode != 0:
                        if re.search(r"password|encrypted|contrase", output_tail, re.I):
                            if not profile_passwords_loaded:
                                profile_passwords_loaded = True
                                for value in self.request_archive_passwords():
                                    if value not in passwords:
                                        passwords.append(value)
                            if attempt + 1 < len(passwords):
                                attempt += 1
                                continue
                            raise RuntimeError(f"No se pudo descomprimir {arc_name}: ninguna contraseña del perfil funcionó. El archivo requiere una contraseña válida. La descarga se conserva.")
                        raise RuntimeError(f"Error al descomprimir {arc_name}: {output_tail.strip()[-300:]}")
                    break
                success = True
            else:
                import zipfile
                import tarfile
                try:
                    enclosing = context.archive_enclosing_folder(arc, None, effective_password or "-")
                    extraction_dir = game_subfolder if not auto_installed and idx == total - 1 and total > 1 and enclosing == "" else os.path.abspath(dest_dir)
                    if not auto_installed and enclosing and idx == 0 and total > 1:
                        game_subfolder = os.path.join(os.path.abspath(dest_dir), enclosing)
                    if zipfile.is_zipfile(arc):
                        with zipfile.ZipFile(arc, 'r') as zf:
                            members = [entry for entry in zf.infolist() if not auto_installed or not os.path.exists(os.path.join(extraction_dir, entry.filename))]
                            zf.extractall(extraction_dir, members=members, pwd=effective_password.encode() if effective_password else None)
                        success = True
                    elif tarfile.is_tarfile(arc):
                        with tarfile.open(arc, 'r') as tf:
                            members = [entry for entry in tf.getmembers() if not auto_installed or not os.path.exists(os.path.join(extraction_dir, entry.name))]
                            tf.extractall(extraction_dir, members=members)
                        success = True
                except Exception as e:
                    raise RuntimeError(f"Error extrayendo {arc_name}: {e}") from e
                if not success:
                    raise RuntimeError(f"No hay un extractor disponible para {arc_name}")

            if success and is_fix(arc) and retain_backup and not auto_installed:
                from game_execution_manager.fix_backup import DigitalArchiveBackup
                DigitalArchiveBackup.retain(arc, dest_dir, extraction_dir, game_name,
                    bool((candidate_password if seven_zip else effective_password) not in (None, "", "-")), source_root=source_root)
            elif success and delete_archive:
                delete_archive_and_parts(arc)
                if arc in context.temp_files:
                    context.temp_files.remove(arc)

        context.emit_progress(
            app_id=context.app_id,
            phase="decompressing",
            progress_percent=100.0,
            status_text="Archivos organizados y listos."
        )
        return True
