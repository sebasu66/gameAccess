"""Download/install orchestration. Transports and archive policy are injected."""
import os
import sys
import time
import shutil
import threading
from pathlib import Path
import game_journal as journal
from launcher_data import data_dir
from urllib.parse import urlparse, unquote
from game_download_manager.source_validation import normalize_download_source, is_torrent_source, validate_downloaded_file
from game_download_manager.route_decision import SwitchToServer, TorrentProbe
from game_download_manager.chunked import ChunkSession, ChunkedDownloader, ChunkedDownloadUnavailable, ChunkedDownloadError, SourceWithoutSeeds
from game_download_manager.client_events import DownloadReporter

class NotAGameError(RuntimeError):
    """The download holds no executable or installer at all (only music, artwork, documents...)."""
    def __init__(self, kinds: list[str]):
        self.kinds = kinds
        super().__init__("Lo que se descargó no es un juego: no tiene ningún ejecutable ni instalador.")


class DownloadPipeline:
    def __init__(self, context, *, watch_controls, cleanup_on_cancel, download_http, download_torrent, extract_archives):
        self.context = context
        self.watch_controls = watch_controls
        self.cleanup_on_cancel = cleanup_on_cancel
        self.download_http = download_http
        self.download_torrent = download_torrent
        self.extract_archives = extract_archives

    def report(self, event, detail="", size=0, wait=False):
        reporter = getattr(self.context, "reporter", None)
        if reporter is not None:
            reporter.send(event, detail, size, wait)

    def step(self, action, *args):
        steps = getattr(self.context, "steps", None)
        if steps is not None:
            getattr(steps, action)(*args)

    def server_or_torrent(self, args, download_source, is_torrent, dest_dir, app_id, game_name):
        """PLUS: download through the server (TorBox -> ViKiNG pieces) or let the torrent run here.

        Returns (path from the server, path from the torrent, cancelled). Both paths are None when the
        caller should run the normal download (no session, or the server could not serve it)."""
        context = self.context
        chunk_path = torrent_path = None
        chunk_session = ChunkSession.from_env(os.getenv("GAMEACCESS_CHUNK_SESSION"))
        # Only PLUS players get a session: they can ask the server, which streams the game back in pieces.
        use_server = bool(chunk_session) and args.source_delivery != "browser" and (
            is_torrent or download_source.lower().startswith(("http://", "https://")))
        if use_server and is_torrent:
            # A torrent the server already holds is streamed from it. Any other one is measured first:
            # it stays with the player when it is small, well seeded or already fast.
            self.step("start", "route", "Buscando si el servidor ya tiene el juego")
            context.emit_progress(app_id, "preparing", 1.0, status_text="Paso 1 de 3 · Buscando la forma más rápida de bajar el juego...")
            where = self.chunked(chunk_session).peek(download_source)
            if where:
                self.step("finish", f"El servidor ya lo tiene en {'Viking' if where == 'viking' else 'Torbox'}")
                self.step("skip", "probe", "El servidor ya lo tiene")
                context.emit_progress(app_id, "preparing", 2.0, status_text=f"Paso 2 de 3 · El servidor ya tiene el juego en {'Viking' if where == 'viking' else 'Torbox'}: descarga acelerada.")
                self.report("server", f"el juego ya estaba en {'Viking' if where == 'viking' else 'Torbox'}")
                context.set_route("accelerated")
                context.logger.info("Ruta de descarga: servidor (el juego ya está en %s).", "Viking" if where == "viking" else "Torbox")
            else:
                self.step("finish", "El servidor todavía no lo tiene")
                probe = TorrentProbe()

                def decide(*sample):
                    verdict = probe.decide(*sample)
                    if verdict == "keep":
                        self.step("finish", f"Rinde bien ({probe.reason}): se baja directo")
                        self.step("skip", "server", "El torrent rinde bien")
                        context.emit_progress(app_id, "downloading", 0.0, status_text=f"Paso 2 de 3 · El torrent rinde bien ({probe.reason}): se baja directo.")
                        self.report("torrent", probe.reason)
                        context.set_route("torrent")
                        context.logger.info("Ruta de descarga: torrent directo (%s).", probe.reason)
                    return verdict

                context.set_route("measuring")
                self.step("start", "probe", "Midiendo fuentes y velocidad del torrent (hasta 20 s)")
                context.emit_progress(app_id, "preparing", 1.0, status_text="Paso 1 de 3 · Probando la velocidad del torrent (hasta 20 s)...")
                self.report("measuring")
                context.logger.info("Midiendo el torrent para elegir la ruta de descarga...")
                try:
                    torrent_path = self.download_torrent(
                        torrent_source=download_source, dest_dir=dest_dir, app_id=app_id, game_name=game_name, probe=decide)
                    if not torrent_path or context.cancelled.is_set():
                        return None, None, True
                    return None, torrent_path, False
                except SwitchToServer as why:
                    self.step("finish", f"Lento ({probe.reason or 'sin datos'}): se acelera por el servidor")
                    self.report("server", f"el torrent no rinde: {probe.reason or 'sin datos'}")
                    context.emit_progress(app_id, "preparing", 2.0, status_text=f"Paso 2 de 3 · El torrent es lento ({probe.reason or 'sin datos'}): se le pide al servidor que acelere la descarga...")
                    context.logger.info("Ruta de descarga: servidor (%s: %s).", why, probe.reason or "sin datos")
        if use_server:
            context.set_route("accelerated")
            self.step("start", "server", "Pidiéndole al servidor la descarga acelerada")
            context.emit_progress(app_id, "preparing", 5.0, status_text="Paso 3 de 3 · Pidiéndole al servidor la descarga acelerada...")
            try:
                chunk_path = self.chunked(chunk_session).download(download_source, game_name, dest_dir, app_id, game_name)
                if context.cancelled.is_set():
                    return None, None, True
                context.logger.info("Descarga por fragmentos completada: %s", chunk_path)
            except SourceWithoutSeeds:
                # Downloading the same torrent here would be just as hopeless: stop and let the player pick another source.
                context.set_route("accelerated")
                raise
            except ChunkedDownloadUnavailable as unavailable:
                self.step("finish", f"El servidor no pudo ({unavailable}): se baja directo", "skipped")
                context.logger.info("Descarga por fragmentos no disponible (%s); se usa la descarga normal.", unavailable)
                self.report("torrent" if is_torrent else "started", f"el servidor no pudo ({unavailable}); se baja directo")
            except ChunkedDownloadError as failure:
                self.step("finish", f"Falló por el servidor ({failure}): se baja directo", "skipped")
                context.logger.warning("La descarga por fragmentos falló (%s); se usa la descarga normal.", failure)
                self.report("torrent" if is_torrent else "started", f"falló por el servidor ({failure}); se baja directo")
        return chunk_path or None, None, False

    def chunked(self, session):
        return ChunkedDownloader(self.context, session)

    def run(self, args):
        context = self.context
        app_id = str(args.appId)
        game_name = args.name

        context.logger.info(f"=== INICIANDO DESCARGA: '{game_name}' (AppID: {app_id}) ===")
        context.reporter = DownloadReporter.from_session(ChunkSession.from_env(os.getenv("GAMEACCESS_CHUNK_SESSION")), app_id, game_name)

        from game_library_manager.storage import DigitalGameStorage
        storage = DigitalGameStorage()
        game_dir = os.path.abspath(args.destination_dir) if args.destination_dir else str(storage.register(int(app_id), game_name))
        # Explicit destinations keep the established test/CLI contract.
        dest_dir = game_dir if args.destination_dir else str(Path(storage.preferences.load()["temporary_root"]) / f"{int(app_id)}-{storage.folder_name(game_name)}")
        context.logger.debug("Resolved storage: game=%s temporary=%s", game_dir, dest_dir)
        if not args.destination_dir and (getattr(args, "source_title", "") or getattr(args, "source_provider", "")):
            storage.set_source(int(app_id), args.source_title, args.source_provider)
        if not args.destination_dir and not args.extract_only:
            # Aborting removes the game folder, its record and the partial download.
            context.cancel_hooks.append(lambda: storage.uninstall(int(app_id), game_name))
        os.makedirs(game_dir, exist_ok=True)
        os.makedirs(dest_dir, exist_ok=True)
        journal.note(game_dir, "descarga", f"inicio de '{game_name}' (AppID {app_id})")

        def set_status(status):
            # The folder name carries the state; explicit destinations keep their name.
            nonlocal game_dir
            if args.destination_dir:
                return
            try:
                game_dir = str(storage.set_status(int(app_id), game_name, status))
                journal.note(game_dir, "estado", status)
            except (OSError, ValueError) as rename_error:
                context.logger.warning("AppID %s: no se pudo marcar la carpeta como %s: %s", app_id, status, rename_error)
        set_status("preparing")

        control_file = data_dir(context.launcher_dir) / ".cache" / "digital_downloads" / f"{app_id}.control.json"
        threading.Thread(target=self.watch_controls, daemon=True).start()

        # Clean any stale status file from previous runs
        try:
            old_status = data_dir(context.launcher_dir) / ".cache" / "digital_downloads" / f"{app_id}.json"
            if old_status.is_file():
                old_status.unlink()
        except Exception:
            pass

        # 1. PHASE: PREPARING
        context.emit_progress(
            app_id=app_id,
            phase="preparing",
            progress_percent=0.0,
            bytes_downloaded=0,
            total_bytes=0,
            speed_bps=0,
            eta_seconds=0,
            status_text="Preparando instalación y verificando espacio en disco..."
        )

        download_source = (args.download_source or "").strip()
        if not args.extract_only and (not download_source or download_source.lower() == "auto"):
            context.emit_error(app_id, "Añade un enlace manual o selecciona una fuente de un plugin.")
            sys.exit(1)

        if args.extract_only:
            context.logger.info(f"Modo: Solo extracción. Archivo: {args.extract_only}")
        else:
            context.logger.info("Fuente manual o de plugin recibida; tipo=%s", "magnet" if download_source.lower().startswith("magnet:") else "archivo")

        download_url = None
        target_filename = None
        target_content_path = os.path.abspath(args.extract_only) if args.extract_only else None
        if not args.extract_only:
            try:
                download_source = normalize_download_source(download_source)
            except ValueError as error:
                context.emit_error(app_id, str(error))
                return
        is_torrent = is_torrent_source(download_source)
        context.logger.debug("Source validated; torrent=%s delivery=%s", is_torrent, args.source_delivery)

        try:
            if args.extract_only:
                if not os.path.exists(target_content_path):
                    raise RuntimeError("No se encontró el archivo descargado para descomprimir.")
            else:
                is_direct_file_link = any(
                    download_source.lower().split("?")[0].endswith(ext)
                    for ext in (".rar", ".zip", ".7z", ".bin", ".iso", ".tar", ".gz")
                ) or "vikingfile.com" in download_source.lower()
                if args.source_delivery == "browser" and not is_direct_file_link:
                    import webbrowser
                    webbrowser.open(download_source)
                    context.logger.info("AppID %s: selected plugin source requires browser download.", app_id)
                    context.emit_progress(app_id, "external", 0, status_text="Fuente abierta en el navegador; el juego todavía no está instalado.")
                    return
                chunk_path, torrent_path, cancelled = self.server_or_torrent(args, download_source, is_torrent, dest_dir, app_id, game_name)
                if cancelled:
                    self.cleanup_on_cancel()
                    return
                if chunk_path:
                    target_content_path = chunk_path
                elif torrent_path:
                    target_content_path = torrent_path
                elif is_torrent:
                    context.set_route("torrent")
                    context.logger.info("Tipo de descarga: P2P Torrent/Magnet directo local")
                    target_content_path = self.download_torrent(
                        torrent_source=download_source,
                        dest_dir=dest_dir,
                        app_id=app_id,
                        game_name=game_name
                    )
                    if not target_content_path or context.cancelled.is_set():
                        self.cleanup_on_cancel()
                        return
                else:
                    context.set_route("direct")
                    context.logger.info("Tipo de descarga: Descarga directa por HTTP/HTTPS")
                    download_url = download_source
                    parsed = urlparse(download_url)
                    target_filename = os.path.basename(unquote(parsed.path)) or "download.bin"


                # 2. PHASE: SEGMENTED HTTP DOWNLOADING (direct HTTP links)
                if download_url:
                    out_filepath = os.path.join(dest_dir, target_filename or "download.bin")
                    context.temp_files.append(out_filepath)
                    target_content_path = out_filepath

                    context.emit_progress(
                        app_id=app_id,
                        phase="downloading",
                        progress_percent=0.0,
                        status_text="Iniciando descarga de alta velocidad..."
                    )

                    ok = self.download_http(
                        url=download_url,
                        output_path=out_filepath,
                        app_id=app_id,
                        game_name=game_name,
                        connections=args.connections
                    )

                    if ok:
                        validate_downloaded_file(out_filepath)
                        context.logger.debug("Downloaded payload validated: %s", out_filepath)
                    if not ok or context.cancelled.is_set():
                        self.cleanup_on_cancel()
                        return

            context.emit_progress(
                app_id=app_id,
                phase="downloading",
                progress_percent=100.0,
                status_text="Descarga finalizada. Preparando instalación..."
            )
            set_status("installing")

            context.wait_if_paused()
            if context.cancelled.is_set():
                self.cleanup_on_cancel()
            # Completed downloads must survive extraction/installation errors or cancellation.
            if target_content_path in context.temp_files:
                context.temp_files.remove(target_content_path)
            context.logger.info("AppID %s: transfer complete; downloaded content=%s; installation folder=%s", app_id, target_content_path, game_dir)
            # 3. PHASE: DECOMPRESSING / EXTRACTING & CLEANUP
            should_delete_archive = bool(storage.preferences.load().get("delete_download_sources", True))  # The declared fix archive is retained either way.
            from disk_space import check_space, folder_size
            downloaded_bytes = folder_size(Path(target_content_path)) if target_content_path and os.path.isdir(target_content_path) else (os.path.getsize(target_content_path) if target_content_path and os.path.isfile(target_content_path) else 0)
            # The archive is already on disk, so unpacking needs about as much again (factor 1.0).
            room = check_space(downloaded_bytes, Path(game_dir), Path(dest_dir), factor=1.0)
            journal.note(game_dir, "espacio", f"descargado {downloaded_bytes} bytes; libre {room['free_bytes']}; " + ("alcanza" if room["ok"] else "no alcanza"))
            if not room["ok"]:
                raise RuntimeError(room["message"])
            journal.note(game_dir, "descompresión", "empieza")
            context.logger.info("AppID %s: extraction starting; auto_installed=%s; archive cleanup=%s", app_id, args.auto_installed, should_delete_archive)
            try:
                extracted = self.extract_archives(
                    target_path=target_content_path or dest_dir,
                    dest_dir=game_dir,
                    source_root=dest_dir,
                    password=args.password,
                    delete_archive=should_delete_archive,
                    game_name=game_name,
                    auto_installed=args.auto_installed
                )
            except Exception as extraction_error:
                if context.cancelled.is_set():
                    raise
                archive_name = os.path.basename(target_content_path or dest_dir)
                raise RuntimeError(f"error intentando descomprimir {archive_name}: {extraction_error}") from extraction_error

            if context.cancelled.is_set():
                self.cleanup_on_cancel()
            if not extracted and dest_dir != game_dir:
                # Non-archive payloads are moved to the game directory after transfer.
                for item in Path(dest_dir).iterdir():
                    target = Path(game_dir) / item.name
                    if target.exists():
                        raise RuntimeError(f"Ya existe el archivo de destino: {target.name}")
                    shutil.move(str(item), str(target))
            if dest_dir != game_dir and Path(dest_dir).is_dir() and not any(Path(dest_dir).iterdir()):
                Path(dest_dir).rmdir()
            journal.note(game_dir, "descompresión", "terminada" if extracted else "sin comprimidos; archivos movidos")
            context.logger.info("AppID %s: extraction finished; extracted=%s; portable installation complete; installProcess is skipped by existing policy", app_id, extracted)
            # Digital is portable: extraction is the installation. Never execute installProcess.
            if context.cancelled.is_set():
                self.cleanup_on_cancel()
            if not args.destination_dir and not any(storage.has_content(Path(game_dir))):
                raise RuntimeError("La descarga terminó pero no se obtuvo ningún archivo del juego.")
            # Music, artwork or a manual is not a game: no executable at all (not even an installer) and nothing to unpack.
            if not args.destination_dir:
                from game_execution_manager.executables import not_a_game
                kinds = not_a_game(Path(game_dir))
                if kinds:
                    raise NotAGameError(kinds)
            # Game Execution Manager: silent setup*.exe if needed, then a runnable executable is required.
            if not args.destination_dir:
                from game_execution_manager import GameExecutionManager, GameExecutionError
                try:
                    GameExecutionManager(storage, logger=context.logger).prepare(int(app_id), game_name,
                        lambda text: context.emit_progress(app_id=app_id, phase="decompressing", progress_percent=99.0, status_text=text))
                except GameExecutionError as manager_error:
                    raise RuntimeError(str(manager_error)) from manager_error
            set_status("ready")
            # 5. PHASE: COMPLETED
            final_size = 0
            if target_content_path and os.path.exists(target_content_path):
                if os.path.isfile(target_content_path):
                    final_size = os.path.getsize(target_content_path)
                elif os.path.isdir(target_content_path):
                    final_size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(target_content_path) for f in fs)

            context.emit_progress(
                app_id=app_id,
                phase="completed",
                progress_percent=100.0,
                bytes_downloaded=final_size,
                total_bytes=final_size,
                speed_bps=0,
                eta_seconds=0,
                status_text=f"¡{game_name} listo para jugar!"
            )
            context.logger.info(f"=== DESCARGA COMPLETADA EXITOSAMENTE: '{game_name}' ===")
            self.report("finished", size=final_size, wait=True)
            sys.exit(0)

        except NotAGameError as e:
            # Nothing in it can run: it is removed from the games folder (and the temporary download with it), never
            # offered as installed or for repair. The app tells the player to look for another source.
            context.logger.warning("AppID %s: '%s' is not a game (%s); the folder is removed", app_id, game_name, ", ".join(e.kinds))
            try:
                storage.uninstall(int(app_id), game_name)
            except Exception as failure:
                context.logger.warning("AppID %s: could not remove the non-game download: %s", app_id, failure)
            self.report("failed", str(e), wait=True)
            self.cleanup_on_cancel(error_message=str(e), error_code="not_a_game", error_detail=e.kinds)
        except Exception as e:
            if not context.cancelled.is_set():
                context.logger.error(f"Error fatal durante la descarga de '{game_name}': {e}", exc_info=True)
            else:
                context.logger.info(f"Descarga cancelada por el usuario: '{game_name}'")
            self.report("cancelled", wait=True) if context.cancelled.is_set() else self.report("failed", str(e), wait=True)
            if not context.cancelled.is_set() and not args.destination_dir:
                self.record_failure(storage, int(app_id), game_name, str(e))
            self.cleanup_on_cancel(error_message=None if context.cancelled.is_set() else str(e))

    DEAD_SOURCE_HINTS = ("404", "410", "sin semillas", "no seeds", "no hay semillas", "metadata", "enlace caído", "enlace caido", "expir")

    def record_failure(self, storage, app_id, game_name, message):
        """Dead source: nothing worth keeping, remove the folder. Otherwise keep it as ERROR with error.txt."""
        try:
            if any(hint in message.lower() for hint in self.DEAD_SOURCE_HINTS):
                storage.uninstall(app_id, game_name)
            else:
                journal.note(storage.folder(app_id, game_name), "error", message)
                storage.write_error(app_id, game_name, message)
        except Exception as failure:
            self.context.logger.warning("AppID %s: no se pudo registrar el error: %s", app_id, failure)
