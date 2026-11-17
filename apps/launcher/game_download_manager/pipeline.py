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
from game_download_manager.source_validation import normalize_download_source, is_direct_file_link, is_torrent_source, validate_downloaded_file
from game_download_manager.route_decision import SwitchToServer, TorrentProbe
from game_download_manager.chunked import ChunkSession, ChunkedDownloader, ChunkedDownloadUnavailable, ChunkedDownloadError, SourceWithoutSeeds
from game_download_manager.client_events import DownloadReporter
from game_download_manager.ui_text import ui
from game_download_manager.source_race import RacePlan

STEAM_DEPOT_PREFIX = "steam-depot:"
# Steam's own install of a free game: how often its appmanifest is read, and how long the player has to confirm
# Steam's install window before the download gives up (no manifest by then: it was closed without installing).
STEAM_INSTALL_POLL_SECONDS = 2.0
STEAM_INSTALL_START_SECONDS = 600.0

# The "-ready" rename: tries and the wait between them (pipeline.set_status).
READY_RENAME_ATTEMPTS = 6
READY_RENAME_WAIT_SECONDS = 2.0

class NotAGameError(RuntimeError):
    """The download holds no executable or installer at all (only music, artwork, documents...)."""
    def __init__(self, kinds: list[str]):
        self.kinds = kinds
        super().__init__("Lo que se descargó no es un juego: no tiene ningún ejecutable ni instalador.")


def drive_of(path):
    """The disk a folder is on ("D:", or the mount on other systems): a library can span several."""
    resolved = os.path.abspath(str(path))
    return os.path.splitdrive(resolved)[0] or os.path.dirname(resolved) or resolved


def room_facts(room):
    """What the player sees in the step that checked the space: free and needed; when short, which folder and disk."""
    return {"freeBytes": int(room.get("free_bytes") or 0), "neededBytes": int(room.get("needed_bytes") or 0),
            **({"folder": room["folder"], "drive": room["drive"]} if not room.get("ok") and room.get("folder") else {})}


class NoSpaceError(RuntimeError):
    """The download and its unpacking do not fit on disk. What was downloaded stays: once the player makes room, a
    retry continues from the same step."""
    code = "no_space"

    def __init__(self, room: dict):
        self.room = room
        super().__init__(room["message"])


def load_race_plan(path):
    """The race plan the queue wrote for this download (--race-file), or None."""
    if not path:
        return None
    import json
    try:
        with open(path, encoding="utf-8") as handle:
            return RacePlan.from_dict(json.load(handle))
    except (OSError, ValueError):
        return None


class DownloadPipeline:
    def __init__(self, context, *, watch_controls, cleanup_on_cancel, download_http, download_torrent, extract_archives,
                 race_torrents=None, drop_race_winner=None):
        self.context = context
        # race_torrents(plan, dest_dir, app_id, game_name) -> winner index or None; drop_race_winner() removes it.
        self.race_torrents = race_torrents
        self.drop_race_winner = drop_race_winner or (lambda: None)
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
            self.step("start", "route", ui("dlRouteLooking"))
            context.emit_progress(app_id, "preparing", 1.0, status_text=ui("dlStepOf", n=1) + ui("dlRouteFastest"))
            where = self.chunked(chunk_session).peek(download_source, app_id)
            if where:
                self.drop_race_winner()  # the server streams it: what the race brought down is not needed
                # The player is never told which service holds it (no provider names in the app).
                self.step("finish", ui("dlRouteServerHas"))
                self.step("skip", "probe", ui("dlRouteServerHas"))
                context.emit_progress(app_id, "preparing", 2.0, status_text=ui("dlStepOf", n=2) + ui("dlRouteServerHasAccelerated"))
                self.report("server", f"el juego ya estaba en {'Viking' if where == 'viking' else 'Torbox'}")
                context.set_route("accelerated")
                context.logger.info("Ruta de descarga: servidor (el juego ya está en %s).", "Viking" if where == "viking" else "Torbox")
            else:
                self.step("finish", ui("dlRouteServerHasNot"))
                probe = TorrentProbe()

                def decide(*sample):
                    verdict = probe.decide(*sample)
                    if verdict == "keep":
                        self.step("finish", f"{ui('dlProbeKeep')} ({probe.why})")
                        self.step("skip", "server", ui("dlProbeGood"))
                        context.emit_progress(app_id, "downloading", 0.0, status_text=f"{ui('dlStepOf', n=2)}{ui('dlProbeKeep')} ({probe.why})")
                        self.report("torrent", probe.reason)
                        context.set_route("torrent")
                        context.logger.info("Ruta de descarga: torrent directo (%s).", probe.reason)
                    return verdict

                context.set_route("measuring")
                self.step("start", "probe", ui("dlProbeMeasuring"))
                context.emit_progress(app_id, "preparing", 1.0, status_text=ui("dlStepOf", n=1) + ui("dlProbeMeasuring"))
                self.report("measuring")
                context.logger.info("Midiendo el torrent para elegir la ruta de descarga...")
                try:
                    torrent_path = self.download_torrent(
                        torrent_source=download_source, dest_dir=dest_dir, app_id=app_id, game_name=game_name, probe=decide)
                    if not torrent_path or context.cancelled.is_set():
                        return None, None, True
                    return None, torrent_path, False
                except SwitchToServer as why:
                    why = probe.why or ui("dlProbeNoData")
                    self.step("finish", f"{ui('dlProbeSlow')} ({why})")
                    self.report("server", f"el torrent no rinde: {probe.reason or 'sin datos'}")
                    context.emit_progress(app_id, "preparing", 2.0, status_text=f"{ui('dlStepOf', n=2)}{ui('dlProbeSlow')} ({why})")
                    context.logger.info("Ruta de descarga: servidor (%s: %s).", why, probe.reason or "sin datos")
        if use_server:
            context.set_route("accelerated")
            self.step("start", "server", ui("dlServerAsking"))
            context.emit_progress(app_id, "preparing", 5.0, status_text=ui("dlStepOf", n=3) + ui("dlServerAsking"))
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
                self.step("finish", f"{ui('dlServerCouldNot')} ({unavailable})", "skipped")
                context.logger.info("Descarga por fragmentos no disponible (%s); se usa la descarga normal.", unavailable)
                self.report("torrent" if is_torrent else "started", f"el servidor no pudo ({unavailable}); se baja directo")
            except ChunkedDownloadError as failure:
                if not is_torrent and not is_direct_file_link(download_source):
                    # A host's page (gofile.io/d/...) is only a web page for the player: downloading it "directly"
                    # cannot work, so the server's failure is the answer (Beyond: Two Souls, 2026-11-09).
                    context.logger.warning("La descarga por fragmentos falló (%s) y la fuente es una página: no se baja directo.", failure)
                    raise RuntimeError(f"{ui('dlErrServerPageSource')} ({failure}). {ui('dlTryAgainOrOther')}") from failure
                self.step("finish", f"{ui('dlServerFailed')} ({failure})", "skipped")
                context.logger.warning("La descarga por fragmentos falló (%s); se usa la descarga normal.", failure)
                self.report("torrent" if is_torrent else "started", f"falló por el servidor ({failure}); se baja directo")
        return chunk_path or None, None, False

    def pick_source(self, args, download_source, dest_dir, app_id, game_name, prior):
        """Several torrents of the game race and the fastest one is the source (source_race.py).

        Only when the app sent a race plan (the server's answer for this player). A download that already started
        from one of the racers goes on with it, without racing again. Returns the source to download."""
        plan = load_race_plan(getattr(args, "race_file", None))
        if plan is None or self.race_torrents is None:
            return download_source
        context = self.context
        racers = []
        for racer in plan.racers:
            try:
                racer.source = normalize_download_source(racer.source)
            except ValueError:
                continue
            if is_torrent_source(racer.source):
                racers.append(racer)
        plan.racers = racers
        if len(racers) < 2:
            return download_source
        if prior.get("step") == "download" and prior.get("source") in [racer.source for racer in racers]:
            context.logger.info("AppID %s: la descarga ya había empezado con una de las fuentes; sigue con ella.", app_id)
            return prior["source"]
        self.step("start", "pick", ui("dlPickRacing", n=len(racers)))
        context.logger.info("Carrera entre %s torrents (decide a los %.0f s, como mucho %.0f s).", len(racers), plan.decide_after, plan.give_up_after)
        winner = self.race_torrents(plan, dest_dir, app_id, game_name)
        if winner is None:
            self.step("finish", ui("dlPickNone"), "skipped")
            return download_source
        racer = racers[winner]
        self.step("finish", ui("dlPickWinner", title=racer.title or game_name))
        self.report("race", f"ganó '{racer.title}' entre {len(racers)}")
        if racer.title:
            args.source_title = racer.title
        if racer.provider:
            args.source_provider = racer.provider
        return racer.source

    def steam_depot(self, args, app_id, game_name, steam=None, sleep=time.sleep, clock=time.monotonic):
        """A free Steam game (`steam-depot:<appid>`): Steam installs it with its own window (Seba, 2026-11-16), with the
        account it has open: no sign-in or QR code of Game Access. The download is followed in Steam's appmanifest.
        Nothing goes to Game Access's own folders. Without Steam the error says "steam_install" (the app offers it)."""
        context = self.context
        from steam_account_manager import SteamAccountManager, client
        source = str(args.download_source).strip()
        depot_app = int(source.split(":", 1)[1] or app_id)
        steam = steam or SteamAccountManager(Path(data_dir()), logger=context.logger)
        if not steam.root:
            context.emit_error(app_id, ui("dlDepotNoSteam"), error_code="steam_install")
            return
        context.set_route("steam")
        self.step("steam")
        state = client.install_state(steam.libraries(), depot_app)
        if not (state and state["installed"]):
            self.step("start", "dialog", ui("dlSteamDialog"))
            context.emit_progress(app_id, "preparing", 1.0, status_text=ui("dlSteamDialog"))
            steam.install(depot_app)
        started, seen = clock(), False
        while not (state and state["installed"]):
            sleep(STEAM_INSTALL_POLL_SECONDS)
            state = client.install_state(steam.libraries(), depot_app)
            if state is None:
                if seen:                        # its manifest went away: the install was cancelled in Steam
                    context.emit_error(app_id, ui("dlSteamCancelled"), error_code="steam_install")
                    return
                if clock() - started > STEAM_INSTALL_START_SECONDS:
                    context.emit_error(app_id, ui("dlSteamNotStarted"), error_code="steam_install")
                    return
                continue
            if not seen:
                seen = True
                self.step("finish", ui("dlSteamDialogDone"))
                self.step("start", "download", ui("dlSteamInstalling"))
                self.step("facts", {"folder": state["folder"], "drive": drive_of(state["folder"] or "."), "library": state["library"]}, "download")
            if not state["installed"]:
                total = state["total_bytes"]
                percent = min(99.0, 100.0 * state["done_bytes"] / total) if total else 2.0
                context.emit_progress(app_id, "downloading", percent, status_text=ui("dlSteamInstalling"),
                                      **({"bytes_downloaded": state["done_bytes"], "total_bytes": total} if total else {}))
        if seen:
            self.step("finish", ui("dlSteamInstalled"))
        context.emit_progress(app_id, "completed", 100.0, total_bytes=state["size_bytes"], status_text=ui("dlSteamDone"))
        return {"steam": True, "size_bytes": state["size_bytes"], "folder": state["folder"]}

    def depot_tool_download(self, args, app_id, game_name, steam=None, download=None):
        """The free Steam game through DepotDownloader, with a remembered account or a QR code, then adopted by
        Steam. Not on the download path now that Steam installs them itself (steam_depot); kept for a PC without
        Steam, which still needs a place to put the game."""
        context = self.context
        from steam_account_manager import SteamAccountManager
        from steam_depot import free_download
        source = str(args.download_source).strip()
        depot_app = int(source.split(":", 1)[1] or app_id)
        steam = steam or SteamAccountManager(Path(data_dir()), logger=context.logger)
        download = download or free_download.download_free_game
        if not steam.root:
            context.emit_error(app_id, ui("dlDepotNoSteam"), error_code="steam_install")
            return
        accounts = [free_download.Account(a.steam_id64, a.account_name, a.most_recent) for a in steam.accounts()]
        context.set_route("steam")
        self.step("steam", "depot")
        self.step("start", "signin", ui("dlDepotSigningIn"))
        context.emit_progress(app_id, "preparing", 1.0, status_text=ui("dlDepotSigningIn"))
        signed = {"account": "", "in": False}

        def status(event, info):
            if event == "target":
                # Where DepotDownloader puts it: the Steam library with room (one of several disks, maybe).
                self.step("facts", {"folder": info.get("folder", ""), "drive": drive_of(info.get("folder", "") or "."), "library": info.get("library", "")}, "download")
            elif event == "account":
                signed["account"] = info.get("account", "")
                self.step("facts", {"account": signed["account"] or "QR"})
                text = ui("dlDepotQr") if info.get("qr") else ui("dlDepotSigningInAs", account=signed["account"]) if signed["account"] else ui("dlDepotSigningIn")
                context.emit_progress(app_id, "preparing", 2.0, status_text=text)
            elif event == "qr":
                # Only when no remembered account could sign in: the app shows the code for a moment, as a pop-up.
                context.emit_progress(app_id, "preparing", 2.0, status_text=ui("dlDepotQr"), steam_qr=info.get("lines", []))
            elif event == "handoff":
                self.step("start", "handoff", ui("dlDepotHandoff"))
                self.step("facts", {"library": info.get("library", "")})
                context.emit_progress(app_id, "installing", 50.0, status_text=ui("dlDepotHandoff"))

        def progress(percent, file):
            if not signed["in"]:
                signed["in"] = True
                self.step("finish", ui("dlDepotSignedIn", account=signed["account"]) if signed["account"] else ui("dlDepotSignedInQr"))
            context.emit_progress(app_id, "downloading", percent, status_text=file)

        try:
            result = download(depot_app, game_name, accounts=accounts, libraries=steam.libraries(),
                              on_progress=progress,
                              on_status=status, login_id=free_download.depot_tool.LOGIN_ID_BASE + (depot_app & 0xFFFF))
        except free_download.DepotUnavailable as error:
            context.logger.info("Depot unavailable for %s: %s", depot_app, error)
            context.emit_error(app_id, ui("dlDepotUnavailable"), error_code="steam_install")
            return
        except Exception as error:              # noqa: BLE001 - every failure reaches the player in words
            context.logger.warning("Depot download of %s failed: %s", depot_app, error)
            context.emit_error(app_id, str(error), error_code="steam_install")
            return
        self.step("finish", ui("dlDepotHandedOff"))
        self.step("start", "adopt", ui("dlDepotAdopt"))
        context.emit_progress(app_id, "installing", 90.0, status_text=ui("dlDepotAdopt"))
        steam.install(depot_app)                # Steam checks the files and takes the game in
        self.step("finish", ui("dlDepotAdopted"))
        context.emit_progress(app_id, "completed", 100.0, total_bytes=result.get("size_bytes", 0),
                              status_text=ui("dlDepotDone", account=result.get("account", "")))
        return result

    def chunked(self, session):
        return ChunkedDownloader(self.context, session)

    def run(self, args):
        context = self.context
        app_id = str(args.appId)
        game_name = args.name

        context.logger.info(f"=== INICIANDO DESCARGA: '{game_name}' (AppID: {app_id}) ===")
        context.reporter = DownloadReporter.from_session(ChunkSession.from_env(os.getenv("GAMEACCESS_CHUNK_SESSION")), app_id, game_name)
        if str(getattr(args, "download_source", "") or "").strip().lower().startswith(STEAM_DEPOT_PREFIX):
            return self.steam_depot(args, app_id, game_name)

        from game_library_manager.storage import DigitalGameStorage
        storage = DigitalGameStorage()
        # What was on disk before this run: automatic cleanup never deletes it (storage.remove_new).
        before = storage.present(int(app_id), game_name) if not args.destination_dir else {"game": True, "transfer": True}
        self.before = before
        game_dir = os.path.abspath(args.destination_dir) if args.destination_dir else str(storage.register(int(app_id), game_name))
        # Explicit destinations keep the established test/CLI contract.
        dest_dir = game_dir if args.destination_dir else str(storage.transfer_folder(int(app_id), game_name))
        context.logger.debug("Resolved storage: game=%s temporary=%s", game_dir, dest_dir)
        if not args.destination_dir and (getattr(args, "source_title", "") or getattr(args, "source_provider", "")):
            storage.set_source(int(app_id), args.source_title, args.source_provider, str(getattr(args, "download_source", "") or ""))
        if not args.destination_dir and not args.extract_only:
            # Aborting removes what this run created; a game folder or a download that was already there stays.
            context.cancel_hooks.append(lambda: storage.remove_new(int(app_id), game_name, before))
        os.makedirs(game_dir, exist_ok=True)
        os.makedirs(dest_dir, exist_ok=True)
        # Where each step works, for the player to see in it (the temporary folder may be on another disk).
        self.step("facts", {"folder": dest_dir, "drive": drive_of(dest_dir)}, "download")
        journal.note(game_dir, "descarga", f"inicio de '{game_name}' (AppID {app_id})")

        def set_status(status):
            # The folder name carries the state; explicit destinations keep their name.
            nonlocal game_dir
            if args.destination_dir:
                return
            # "ready" is what makes it a library game: a file still held open (the antivirus scanning what was just
            # unpacked, an installer finishing) blocks the rename for a moment, so it is tried again; if it never
            # goes, the download fails instead of saying "ready" over a folder the library does not take as installed.
            attempts = READY_RENAME_ATTEMPTS if status == "ready" else 1
            for attempt in range(1, attempts + 1):
                try:
                    game_dir = str(storage.set_status(int(app_id), game_name, status))
                    journal.note(game_dir, "estado", status)
                    return
                except (OSError, ValueError) as rename_error:
                    context.logger.warning("AppID %s: no se pudo marcar la carpeta como %s (intento %s de %s): %s", app_id, status, attempt, attempts, rename_error)
                    if attempt == attempts:
                        if status == "ready":
                            raise RuntimeError(f"{ui('dlErrReadyRename')} ({rename_error})") from rename_error
                        return
                    time.sleep(READY_RENAME_WAIT_SECONDS)
        set_status("preparing")

        def room_check(total_bytes, on_disk_bytes):
            # The games root is the folder's parent (a status rename keeps it there).
            from disk_space import allocated_size, check_download
            # The transport may not know yet what is already here (a torrent reports nothing until it has re-checked
            # its files): what the temporary folder really takes on disk counts as well.
            on_disk_bytes = max(int(on_disk_bytes or 0), min(allocated_size(Path(dest_dir)), int(total_bytes)))
            room = check_download(total_bytes, on_disk_bytes, Path(game_dir).parent, Path(dest_dir))
            journal.note(game_dir, "espacio", f"descarga de {total_bytes} bytes ({on_disk_bytes} ya en disco); libre {room['free_bytes']}; " + ("alcanza" if room["ok"] else "no alcanza"))
            self.step("facts", room_facts(room), "download")
            if not room["ok"]:
                raise NoSpaceError(room)
        context.set_room_check(room_check)

        # The step the download is at, kept with the install so a retry goes on from there (also without the plugin).
        remember = not args.destination_dir
        failed_step = "download"

        def resume_at(step, archive="", error=""):
            nonlocal failed_step
            failed_step = step
            if not remember:
                return
            try:
                storage.set_resume(int(app_id), step, source=download_source, delivery=args.source_delivery,
                                   source_title=getattr(args, "source_title", ""), source_provider=getattr(args, "source_provider", ""),
                                   auto_installed=bool(args.auto_installed), archive=archive, error=error)
            except (OSError, ValueError) as failure:
                context.logger.warning("AppID %s: no se pudo guardar el paso de la descarga: %s", app_id, failure)

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
        prior = {}
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
        if remember and not args.extract_only:
            # Already downloaded from this same source (unpacking failed or was cut): go on from the unpacking.
            resume = prior = storage.resume_point(int(app_id))
            same = resume.get("source") in ("", None, download_source, args.download_source) or (
                bool(getattr(args, "source_title", "")) and resume.get("source_title") == args.source_title)
            if resume.get("step") == "extract" and same:
                args.extract_only = resume["archive"]
                target_content_path = os.path.abspath(args.extract_only)
                context.logger.info("AppID %s: ya estaba descargado (%s); se sigue desde la descompresión.", app_id, target_content_path)
                journal.note(game_dir, "descarga", "ya descargada; se retoma desde la descompresión")
                for step_id in ("route", "probe", "server"):
                    self.step("skip", step_id, ui("dlAlreadyDownloaded"))
                self.step("start", "download", ui("dlAlreadyDownloaded"))
                self.step("finish", ui("dlAlreadyDownloaded"))
            else:
                resume_at("download")

        try:
            if args.extract_only:
                if not os.path.exists(target_content_path):
                    raise RuntimeError("No se encontró el archivo descargado para descomprimir.")
            else:
                if args.source_delivery == "browser" and not is_direct_file_link(download_source):
                    import webbrowser
                    webbrowser.open(download_source)
                    context.logger.info("AppID %s: selected plugin source requires browser download.", app_id)
                    context.emit_progress(app_id, "external", 0, status_text="Fuente abierta en el navegador; el juego todavía no está instalado.")
                    return
                if is_torrent:
                    picked = self.pick_source(args, download_source, dest_dir, app_id, game_name, prior)
                    if context.cancelled.is_set():
                        self.cleanup_on_cancel()
                        return
                    if picked != download_source:
                        download_source = picked
                        resume_at("download")  # a retry goes on with the winner
                        if not args.destination_dir:
                            storage.set_source(int(app_id), args.source_title, args.source_provider, download_source)
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
                    # Cancelling deletes only what this run created: an earlier download it goes on from stays (Seba, 2026-11-05).
                    if not os.path.exists(out_filepath):
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
                        try:
                            validate_downloaded_file(out_filepath)
                        except RuntimeError:
                            # A web page instead of the game: nothing worth keeping for a retry.
                            for leftover in (out_filepath, out_filepath + ".parts.json"):
                                if os.path.exists(leftover):
                                    os.remove(leftover)
                            raise
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
            resume_at("extract", archive=target_content_path or dest_dir)
            context.logger.info("AppID %s: transfer complete; downloaded content=%s; installation folder=%s", app_id, target_content_path, game_dir)
            # 3. PHASE: DECOMPRESSING / EXTRACTING & CLEANUP
            should_delete_archive = bool(storage.preferences.load().get("delete_download_sources", True))  # The declared fix archive is retained either way.
            from disk_space import check_download, folder_size
            downloaded_bytes = folder_size(Path(target_content_path)) if target_content_path and os.path.isdir(target_content_path) else (os.path.getsize(target_content_path) if target_content_path and os.path.isfile(target_content_path) else 0)
            # The archive is all here: unpacking needs about as much again in the games folder. That check is already
            # the unpacking's: a lack of room stops this step, not the download that ended.
            self.step("start", "extract", ui("dlExtractRoom"))
            self.step("facts", {"folder": game_dir, "drive": drive_of(game_dir), "from": os.path.basename(target_content_path or dest_dir)})
            room = check_download(downloaded_bytes, downloaded_bytes, Path(game_dir).parent, Path(dest_dir))
            # The download ends here; unpacking it is the install, a process of its own (the game's log says where one ends).
            journal.note(game_dir, "descarga", f"terminada; {downloaded_bytes} bytes")
            journal.note(game_dir, "espacio", f"descargado {downloaded_bytes} bytes; libre {room['free_bytes']}; " + ("alcanza" if room["ok"] else "no alcanza"))
            self.step("facts", room_facts(room))
            if not room["ok"]:
                raise NoSpaceError(room)
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
            if dest_dir != game_dir and Path(dest_dir).is_dir():
                # Only empty folders go: a download by pieces leaves its content folder empty inside the temporary one.
                for folder, _, _ in os.walk(dest_dir, topdown=False):
                    try:
                        os.rmdir(folder)
                    except OSError:
                        pass
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
                    # Setting it up to run (a silent setup, the executable) is its own stage for the player: "installing".
                    context.emit_progress(app_id=app_id, phase="installing", progress_percent=99.0, status_text=ui("dlSetupStarting"))
                    self.step("facts", {"folder": game_dir, "drive": drive_of(game_dir)})
                    GameExecutionManager(storage, logger=context.logger).prepare(int(app_id), game_name,
                        lambda text: context.emit_progress(app_id=app_id, phase="installing", progress_percent=99.0, status_text=text))
                except GameExecutionError as manager_error:
                    raise RuntimeError(str(manager_error)) from manager_error
            set_status("ready")
            if remember:
                storage.clear_resume(int(app_id))
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
            # Nothing in it can run: what this run brought is removed (never what was there before), never offered as
            # installed or for repair. The app tells the player to look for another source.
            context.logger.warning("AppID %s: '%s' is not a game (%s); what this download brought is removed", app_id, game_name, ", ".join(e.kinds))
            try:
                storage.remove_new(int(app_id), game_name, before)
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
                self.record_failure(storage, int(app_id), game_name, str(e), dead_source_possible=not isinstance(e, NoSpaceError))
                # Kept with the install (a dead source removed it): what the retry continues from, and why it stopped.
                resume_at(failed_step, error=str(e))
            if context.cancelled.is_set():
                self.cleanup_on_cancel()
            else:
                # A dead source took everything with it: nothing to continue from.
                kept = args.destination_dir or bool(storage.resume_point(int(app_id)))
                self.cleanup_on_cancel(error_message=str(e), error_code=getattr(e, "code", ""), resume_step=failed_step if kept else "")

    DEAD_SOURCE_HINTS = ("404", "410", "dlsourcenoseeds", "sin semillas", "no seeds", "no hay semillas", "metadata", "enlace caído", "enlace caido", "expir")

    def record_failure(self, storage, app_id, game_name, message, dead_source_possible=True):
        """Dead source: what this run brought is removed (a folder that was there before stays, as ERROR). Otherwise
        keep it as ERROR with error.txt."""
        try:
            if dead_source_possible and any(hint in message.lower() for hint in self.DEAD_SOURCE_HINTS):
                if not storage.remove_new(app_id, game_name, getattr(self, "before", {"game": True, "transfer": True})):
                    return
            journal.note(storage.folder(app_id, game_name), "error", message)
            storage.write_error(app_id, game_name, message)
        except Exception as failure:
            self.context.logger.warning("AppID %s: no se pudo registrar el error: %s", app_id, failure)
