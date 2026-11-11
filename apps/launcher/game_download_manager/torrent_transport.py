"""libtorrent transfer; runtime context owns pause/cancel and status."""
from __future__ import annotations
import os
import shutil
import time
import requests

from game_download_manager.route_decision import SwitchToServer
from game_download_manager.source_race import Lane, RacePlan, race_winner
from game_download_manager.ui_text import ui

# libtorrent reports these as errors, but they only mean a peer hung up or the router has no UPnP.
_LIBTORRENT_NOISE = ("UDP error:", "could not map port", "no router found")


def is_libtorrent_noise(message: str) -> bool:
    return any(marker in message for marker in _LIBTORRENT_NOISE)


def remove_and_delete(ses, handle, lt) -> None:
    """Remove the torrent and the files it started writing (a torrent handed over to the server)."""
    flag = getattr(getattr(lt, "options_t", None), "delete_files", None)
    if flag is None:
        flag = getattr(getattr(lt, "session", None), "delete_files", None)
    if flag is None:
        ses.remove_torrent(handle)
    else:
        ses.remove_torrent(handle, flag)


DEFAULT_TRACKERS = (
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://public.popcorn-tracker.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
)
DHT_BOOTSTRAP = (
    ("router.bittorrent.com", 6881),
    ("dht.transmissionbt.com", 6881),
    ("router.utorrent.com", 6881),
    ("dht.libtorrent.org", 25401),
)
METADATA_TIMEOUT_SECONDS = 45.0
RACE_FOLDER = ".ga-race-{}"   # each racer writes in its own folder inside the transfer folder until it wins
MOVE_TIMEOUT_SECONDS = 120.0

# The race's winner, still downloading in its session, until download_direct_torrent takes it over (one download per
# worker process, and the transport is built anew for each call, so it waits here).
_handoff: dict = {}


def take_race_winner(source: str):
    """The (session, handle) the race left running for this source, or None."""
    if _handoff.get("source") == source:
        found = (_handoff["session"], _handoff["handle"])
        _handoff.clear()
        return found
    return None


def _seeds(status) -> int:
    return max(int(getattr(status, "num_seeds", 0) or 0), int(getattr(status, "list_seeds", 0) or 0))


class TorrentDownloadTransport:
    def __init__(self, context):
        self.context = context

    def _open_session(self, lt):
        settings = {
            'listen_interfaces': '0.0.0.0:0,[::]:0',
            'enable_dht': True,
            'enable_lsd': True,
            'enable_upnp': True,
            'enable_natpmp': True,
            'alert_mask': lt.alert.category_t.error_notification | lt.alert.category_t.status_notification
        }
        ses = lt.session(settings)
        self.context.torrent_session = ses
        for host, port in DHT_BOOTSTRAP:
            ses.add_dht_node((host, port))
        return ses

    def _add_torrent(self, ses, lt, torrent_source: str, save_path: str, app_id: str, temp_name: str):
        """Adds a magnet, a .torrent file or a .torrent link with the public trackers; returns (handle, temp file)."""
        context = self.context
        temp_torrent_path = None
        if torrent_source.startswith("magnet:?"):
            params = lt.parse_magnet_uri(torrent_source)
            trackers = set(getattr(params, "trackers", []))
        else:
            path = torrent_source
            if torrent_source.startswith("http://") or torrent_source.startswith("https://"):
                temp_torrent_path = path = os.path.join(save_path, temp_name)
                context.temp_files.append(temp_torrent_path)
                context.emit_progress(app_id, "preparing", 14.0, status_text="Descargando manifiesto de instalación...")
                r = requests.get(torrent_source, timeout=30)
                r.raise_for_status()
                with open(temp_torrent_path, "wb") as f:
                    f.write(r.content)
            elif not os.path.isfile(torrent_source):
                raise ValueError(f"Fuente de descarga inválida: {torrent_source}")
            info = lt.torrent_info(path)
            params = lt.add_torrent_params()
            params.ti = info
            trackers = {t.url for t in info.trackers()} if hasattr(info, "trackers") else set()
        params.save_path = save_path
        params.trackers = list(trackers | set(DEFAULT_TRACKERS))
        return ses.add_torrent(params), temp_torrent_path

    def _log_alerts(self, session, lt):
        context = self.context
        for alert in session.pop_alerts():
            if alert.category() & lt.alert.category_t.error_notification:
                message = alert.message()
                # libtorrent announces through every network adapter, including virtual ones
                # (VirtualBox, WSL, loopback) that cannot reach a tracker. Those are expected
                # and not errors; real failures are reported once metadata times out.
                if "(udp://" in message or "(http://" in message or "(https://" in message:
                    context.logger.debug(f"[Libtorrent Tracker] {message}")
                elif is_libtorrent_noise(message):
                    context.logger.debug(f"[Libtorrent Noise] {message}")
                else:
                    context.logger.error(f"[Libtorrent Error] {message}")
            elif alert.category() & lt.alert.category_t.status_notification:
                context.logger.info(f"[Libtorrent Status] {alert.message()}")

    def race(self, plan: RacePlan, dest_dir: str, app_id: str, game_name: str) -> int | None:
        """Starts every racer at once in one session; after the plan's time the one that brought down the most goes on.

        Returns the winner's index (its torrent keeps downloading and is moved into `dest_dir`, where
        download_direct_torrent takes it over with what it already has), or None when cancelled or nobody found
        anything (then the caller downloads the first source as before)."""
        context = self.context
        try:
            import libtorrent as lt
        except ImportError:
            raise RuntimeError("El módulo libtorrent no está instalado. Ejecute: pip install libtorrent")
        context.emit_progress(app_id, "preparing", 1.0, status_text=ui("dlPickRacing", n=len(plan.racers)))
        ses = self._open_session(lt)
        entries = []  # (racer, handle or None, folder, temp file)
        for index, racer in enumerate(plan.racers):
            folder = os.path.join(dest_dir, RACE_FOLDER.format(index))
            os.makedirs(folder, exist_ok=True)
            context.temp_files.append(folder)
            try:
                handle, temp = self._add_torrent(ses, lt, racer.source, folder, app_id, f"{app_id}_race{index}.torrent")
            except Exception as failure:  # a bad link only drops that racer
                context.logger.warning("Carrera: no se pudo sumar '%s' (%s).", racer.title or racer.source[:60], failure)
                handle, temp = None, None
            entries.append((racer, handle, folder, temp))
        lanes = [Lane(dropped=handle is None) for _, handle, _, _ in entries]

        def drop(index):
            racer, handle, folder, temp = entries[index]
            lanes[index].dropped = True
            if handle is not None:
                remove_and_delete(ses, handle, lt)
            for leftover in (folder, temp):
                if leftover and leftover in context.temp_files:
                    context.temp_files.remove(leftover)
            shutil.rmtree(folder, ignore_errors=True)  # libtorrent deletes in the background; what is left goes too
            if temp and os.path.exists(temp):
                try:
                    os.remove(temp)
                except OSError:
                    pass

        def lanes_view(winner=None):
            return [{"title": racer.title, "provider": racer.provider, "done": lane.done, "total": lane.total,
                     "speed": lane.speed, "seeds": lane.seeds,
                     "state": "won" if index == winner else ("out" if lane.dropped else "racing")}
                    for index, ((racer, *_), lane) in enumerate(zip(entries, lanes))]

        started = time.time()
        winner = None
        while True:
            context.wait_if_paused()
            self._log_alerts(ses, lt)
            if context.cancelled.is_set():
                for index in range(len(entries)):
                    if not lanes[index].dropped:
                        drop(index)
                context.torrent_session = None
                return None
            elapsed = time.time() - started
            for index, (_, handle, _, _) in enumerate(entries):
                lane = lanes[index]
                if lane.dropped:
                    continue
                status = handle.status()
                lane.metadata = bool(status.has_metadata)
                lane.done = int(status.total_wanted_done or 0)
                lane.total = int(status.total_wanted or 0)
                lane.speed = int(status.download_rate or 0)
                lane.seeds = max(lane.seeds, _seeds(status))
                lane.finished = bool(lane.metadata and lane.total and (status.is_finished or lane.done >= lane.total))
                if not lane.metadata and elapsed > plan.metadata_timeout:
                    context.logger.info("Carrera: '%s' no encontró fuentes; sale.", entries[index][0].title)
                    drop(index)
            if all(lane.dropped for lane in lanes):
                context.torrent_session = None
                context.logger.info("Carrera: ninguna fuente respondió.")
                return None
            winner = race_winner(plan, elapsed, lanes)
            alive = sum(not lane.dropped for lane in lanes)
            context.emit_progress(app_id, "preparing", min(1.0 + elapsed / plan.give_up_after * 4.0, 5.0),
                                  bytes_downloaded=sum(lane.done for lane in lanes if not lane.dropped),
                                  speed_bps=sum(lane.speed for lane in lanes if not lane.dropped),
                                  status_text=ui("dlPickRacing", n=alive), race=lanes_view(winner))
            if winner is not None:
                break
            time.sleep(0.5)

        for index in range(len(entries)):
            if index != winner and not lanes[index].dropped:
                drop(index)
        racer, handle, folder, temp = entries[winner]
        context.logger.info("Carrera: gana '%s' con %s bytes en %.0f s.", racer.title, lanes[winner].done, time.time() - started)
        # The winner keeps all it has: it goes on in the same session, only its files move into the transfer folder.
        handle.move_storage(dest_dir)
        deadline = time.time() + MOVE_TIMEOUT_SECONDS
        while os.path.normcase(os.path.abspath(handle.status().save_path)) != os.path.normcase(os.path.abspath(dest_dir)):
            self._log_alerts(ses, lt)
            if time.time() > deadline:
                context.logger.warning("Carrera: el ganador no terminó de moverse; sigue desde su carpeta.")
                break
            time.sleep(0.2)
        if folder in context.temp_files:
            context.temp_files.remove(folder)
        try:
            os.rmdir(folder)
        except OSError:
            pass
        context.emit_progress(app_id, "preparing", 5.0, bytes_downloaded=lanes[winner].done, total_bytes=lanes[winner].total,
                              status_text=ui("dlPickWinner", title=racer.title or game_name), race=lanes_view(winner))
        _handoff.clear()
        _handoff.update(source=racer.source, session=ses, handle=handle)
        return winner

    def drop_race_winner(self) -> None:
        """The race's winner is not downloaded here after all (the server already has the game): remove it and its files."""
        if not _handoff:
            return
        import libtorrent as lt
        ses, handle = _handoff["session"], _handoff["handle"]
        _handoff.clear()
        remove_and_delete(ses, handle, lt)
        self.context.torrent_session = None

    def download_direct_torrent(self,
        torrent_source: str,
        dest_dir: str,
        app_id: str,
        game_name: str,
        probe=None,
    ) -> str:
        """
        Downloads torrent content directly using libtorrent (matching Hydra's TorrentService).
        Zero technical jargon emitted to the user.
        Returns path of downloaded file or directory.

        `probe(elapsed, total, seeds, done)` (a PLUS player) is asked while the torrent starts whether to
        keep it ("keep") or hand it to the server ("server"): then the torrent and what it wrote are
        removed and SwitchToServer is raised. A torrent that finds no peers at all goes to the server too.
        A torrent that won the race (`race`) is taken over as it is, with what it already downloaded.
        """
        context = self.context
        try:
            import libtorrent as lt
        except ImportError:
            raise RuntimeError("El módulo libtorrent no está instalado. Ejecute: pip install libtorrent")

        temp_torrent_path = None
        taken = take_race_winner(torrent_source)
        if taken:
            ses, handle = taken
            context.torrent_session = ses
        else:
            context.emit_progress(
                app_id=app_id,
                phase="preparing",
                progress_percent=12.0,
                status_text=f"Conectando con la red para preparar {game_name}..."
            )
            ses = self._open_session(lt)
            handle, temp_torrent_path = self._add_torrent(ses, lt, torrent_source, dest_dir, app_id, f"{app_id}_temp.torrent")

        def log_libtorrent_alerts(session):
            self._log_alerts(session, lt)

        # Wait for metadata if necessary (timeout after 45 seconds if no peers/trackers answer)
        meta_start = time.time()
        while not handle.status().has_metadata:
            context.wait_if_paused()
            log_libtorrent_alerts(ses)
            if context.cancelled.is_set():
                ses.remove_torrent(handle)
                return ""
            elapsed = time.time() - meta_start
            if elapsed > METADATA_TIMEOUT_SECONDS:
                ses.remove_torrent(handle)
                if probe is not None:
                    raise SwitchToServer("el torrent no encontró fuentes")
                err_msg = f"No se pudo conectar con las fuentes de descarga para '{game_name}' (sin pares activos disponibles)."
                context.emit_error(app_id, err_msg)
                raise TimeoutError(err_msg)
            context.emit_progress(
                app_id=app_id,
                phase="preparing",
                progress_percent=min(14.0 + (elapsed * 0.4), 35.0),
                status_text="Conectando con fuentes de descarga..."
            )
            time.sleep(1)

        tinfo = handle.torrent_file()
        torrent_name = tinfo.name() if tinfo else game_name
        total_wanted = handle.status().total_wanted or (tinfo.total_size() if tinfo else 0)
        # A resumed download is still being verified here and reports nothing done: wait for the check to end,
        # or the whole game would be counted as missing and a half-finished 100 GB download refused for lack of room.
        checking_states = tuple(getattr(lt.torrent_status, name) for name in ("checking_resume_data", "checking_files")
                                if hasattr(lt.torrent_status, name))
        while handle.status().state in checking_states:
            context.wait_if_paused()
            log_libtorrent_alerts(ses)
            if context.cancelled.is_set():
                ses.remove_torrent(handle)
                return ""
            checking = handle.status()
            context.emit_progress(app_id=app_id, phase="preparing", progress_percent=checking.progress * 100.0,
                                  total_bytes=total_wanted, check_percent=checking.progress * 100.0,
                                  status_text=f"Verificando archivos existentes ({checking.progress * 100.0:.1f}%)")
            time.sleep(0.5)
        # Now the size is known: stop before downloading what would not fit (what is already here counts).
        getattr(context, "ensure_room", lambda *_: None)(total_wanted, handle.status().total_wanted_done)

        target_path = os.path.join(dest_dir, torrent_name)
        # Cancelling deletes only what this run created: an earlier download it goes on from stays (Seba, 2026-11-05).
        if not os.path.exists(target_path):
            context.temp_files.append(target_path)

        context.emit_progress(
            app_id=app_id,
            phase="downloading",
            progress_percent=0.0,
            bytes_downloaded=0,
            total_bytes=total_wanted,
            status_text=f"Iniciando descarga de {game_name}..."
        )

        last_emit = 0
        probe_started = time.time()
        while not context.cancelled.is_set():
            context.wait_if_paused()
            log_libtorrent_alerts(ses)
            s = handle.status()
            if probe is not None:
                seeds = _seeds(s)
                verdict = probe(time.time() - probe_started, int(s.total_wanted or total_wanted), seeds, int(s.total_wanted_done))
                if verdict == "keep":
                    probe = None
                elif verdict == "server":
                    remove_and_delete(ses, handle, lt)
                    context.torrent_session = None
                    if target_path in context.temp_files:
                        context.temp_files.remove(target_path)
                    raise SwitchToServer("el torrent no conviene bajarlo directo")
            progress = s.progress * 100.0
            bytes_done = s.total_wanted_done
            total_bytes = s.total_wanted or total_wanted
            speed = s.download_rate

            remaining = max(total_bytes - bytes_done, 0)
            eta = int(remaining / speed) if speed > 0 else 0

            now = time.time()
            if now - last_emit >= 0.5:
                last_emit = now
                if s.state == lt.torrent_status.checking_files:
                    status_text = f"Verificando archivos existentes ({progress:.1f}%)"
                else:
                    status_text = f"Descargando {game_name} ({progress:.1f}%)"

                context.emit_progress(
                    app_id=app_id,
                    phase="downloading",
                    progress_percent=progress,
                    bytes_downloaded=bytes_done,
                    total_bytes=total_bytes,
                    speed_bps=speed,
                    eta_seconds=eta,
                    status_text=status_text
                )

            if s.is_finished or s.state in (lt.torrent_status.finished, lt.torrent_status.seeding) or progress >= 100.0:
                break

            time.sleep(0.5)

        if context.cancelled.is_set():
            ses.remove_torrent(handle)
            return ""

        ses.remove_torrent(handle)
        context.torrent_session = None

        if temp_torrent_path and os.path.exists(temp_torrent_path):
            try: os.remove(temp_torrent_path)
            except Exception: pass

        return target_path
