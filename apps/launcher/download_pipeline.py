"""Download/install orchestration. Transports and archive policy are injected."""
import os
import sys
import time
import shutil
import threading
from pathlib import Path
from urllib.parse import urlparse, unquote
from download_source_validation import normalize_download_source, is_torrent_source, validate_downloaded_file
from debrid_client import TorboxClient

class DownloadPipeline:
    def __init__(self, context, *, watch_controls, cleanup_on_cancel, download_http, download_torrent, extract_archives):
        self.context = context
        self.watch_controls = watch_controls
        self.cleanup_on_cancel = cleanup_on_cancel
        self.download_http = download_http
        self.download_torrent = download_torrent
        self.extract_archives = extract_archives

    def run(self, args):
        context = self.context
        app_id = str(args.appId)
        game_name = args.name

        context.logger.info(f"=== INICIANDO DESCARGA: '{game_name}' (AppID: {app_id}) ===")

        from digital_storage import DigitalGameStorage
        storage = DigitalGameStorage()
        game_dir = os.path.abspath(args.destination_dir) if args.destination_dir else str(storage.register(int(app_id), game_name))
        # Explicit destinations keep the established test/CLI contract.
        dest_dir = game_dir if args.destination_dir else str(Path(storage.preferences.load()["temporary_root"]) / f"{int(app_id)}-{storage.folder_name(game_name)}")
        context.logger.debug("Resolved storage: game=%s temporary=%s", game_dir, dest_dir)
        os.makedirs(game_dir, exist_ok=True)
        os.makedirs(dest_dir, exist_ok=True)

        control_file = context.launcher_dir / ".cache" / "digital_downloads" / f"{app_id}.control.json"
        threading.Thread(target=self.watch_controls, daemon=True).start()

        # Clean any stale status file from previous runs
        try:
            old_status = context.launcher_dir / ".cache" / "digital_downloads" / f"{app_id}.json"
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
                if is_torrent:
                    torbox_key = (args.torbox_key or os.getenv("TORBOX_API_KEY", "")).strip()
                    use_torbox = False

                    if torbox_key:
                        context.logger.info("Tipo de descarga: Red P2P mediante servidor de alta velocidad (Torbox/Boxtop)")
                        try:
                            tb = TorboxClient(torbox_key)
                            context.emit_progress(app_id, "preparing", 10.0, status_text="Verificando disponibilidad en servidores de alta velocidad...")

                            is_cached = tb.check_cached(download_source)
                            if is_cached:
                                context.emit_progress(app_id, "preparing", 18.0, status_text="Servidor optimizado detectado. Acceso rápido listo.")

                            # Submit package to high-speed cloud resolver
                            torrent_id = tb.add_torrent(download_source)
                            context.emit_progress(app_id, "preparing", 22.0, status_text="Conectando con servidores de descarga rápida...")

                            # Poll cloud status until completed/cached (up to 30 attempts)
                            tb_attempts = 0
                            while not context.cancelled.is_set() and tb_attempts < 30:
                                tb_attempts += 1
                                status = tb.get_status(torrent_id)
                                if status:
                                    is_finished = status.get("download_finished", False)
                                    state = status.get("download_state", "unknown")
                                    progress = status.get("progress", 0.0)
                                    pct = progress if progress > 1.0 else progress * 100

                                    context.emit_progress(
                                        app_id=app_id,
                                        phase="preparing",
                                        progress_percent=min(pct * 0.25 + 22.0, 48.0),
                                        status_text=f"Preparando archivos en servidores de alta velocidad ({pct:.0f}%)..."
                                    )

                                    if is_finished or state in ("completed", "cached") or pct >= 100.0:
                                        raw_files = status.get("files") or []
                                        files = [f for f in raw_files if isinstance(f, dict)]
                                        t_name = status.get("name", "game_package")

                                        if len(files) == 1:
                                            f_obj = files[0]
                                            target_filename = f_obj.get("name") or t_name
                                            file_id = f_obj.get("id")
                                            download_url = tb.request_link(torrent_id, file_id=file_id, zip_link=False)
                                        else:
                                            target_filename = f"{t_name}.zip"
                                            download_url = tb.request_link(torrent_id, zip_link=True)
                                        use_torbox = True
                                        break
                                time.sleep(2)
                        except Exception as tb_err:
                            context.logger.warning(f"Error al conectar con servidor TorBox/Boxtop: {tb_err}")
                            context.emit_progress(
                                app_id=app_id,
                                phase="preparing",
                                progress_percent=15.0,
                                status_text="Servidor optimizado no disponible. Continuando con descarga directa..."
                            )
                            use_torbox = False

                    # If TorBox is unavailable or has no key, fall back to direct torrent download
                    if not use_torbox or not download_url:
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
                    context.logger.info("Tipo de descarga: Descarga directa por HTTP/HTTPS")
                    download_url = download_source
                    parsed = urlparse(download_url)
                    target_filename = os.path.basename(unquote(parsed.path)) or "download.bin"


                # 2. PHASE: SEGMENTED HTTP DOWNLOADING (If link from TorBox or direct HTTP)
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

            context.wait_if_paused()
            if context.cancelled.is_set():
                self.cleanup_on_cancel()
            # Completed downloads must survive extraction/installation errors or cancellation.
            if target_content_path in context.temp_files:
                context.temp_files.remove(target_content_path)
            context.logger.info("AppID %s: transfer complete; downloaded content=%s; installation folder=%s", app_id, target_content_path, game_dir)
            # 3. PHASE: DECOMPRESSING / EXTRACTING & CLEANUP
            should_delete_archive = True  # Only the smallest original archive is retained.
            context.logger.info("AppID %s: extraction starting; auto_installed=%s; archive cleanup=%s", app_id, args.auto_installed, should_delete_archive)
            extracted = self.extract_archives(
                target_path=target_content_path or dest_dir,
                dest_dir=game_dir,
                source_root=dest_dir,
                password=args.password,
                delete_archive=should_delete_archive,
                game_name=game_name,
                auto_installed=args.auto_installed
            )

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
            context.logger.info("AppID %s: extraction finished; extracted=%s; portable installation complete; installProcess is skipped by existing policy", app_id, extracted)
            # Digital is portable: extraction is the installation. Never execute installProcess.
            if context.cancelled.is_set():
                self.cleanup_on_cancel()
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
            sys.exit(0)

        except Exception as e:
            if not context.cancelled.is_set():
                context.logger.error(f"Error fatal durante la descarga de '{game_name}': {e}", exc_info=True)
            else:
                context.logger.info(f"Descarga cancelada por el usuario: '{game_name}'")
            self.cleanup_on_cancel(error_message=None if context.cancelled.is_set() else str(e))
