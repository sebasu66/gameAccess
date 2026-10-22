"""libtorrent transfer; runtime context owns pause/cancel and status."""
from __future__ import annotations
import os
import time
import requests

from game_download_manager.route_decision import SwitchToServer

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


class TorrentDownloadTransport:
    def __init__(self, context):
        self.context = context

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
        """
        context = self.context
        try:
            import libtorrent as lt
        except ImportError:
            raise RuntimeError("El módulo libtorrent no está instalado. Ejecute: pip install libtorrent")

        context.emit_progress(
            app_id=app_id,
            phase="preparing",
            progress_percent=12.0,
            status_text=f"Conectando con la red para preparar {game_name}..."
        )

        settings = {
            'listen_interfaces': '0.0.0.0:0,[::]:0',
            'enable_dht': True,
            'enable_lsd': True,
            'enable_upnp': True,
            'enable_natpmp': True,
            'alert_mask': lt.alert.category_t.error_notification | lt.alert.category_t.status_notification
        }
        ses = lt.session(settings)
        context.torrent_session = ses

        default_trackers = [
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://open.stealth.si:80/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://tracker.bittor.pw:1337/announce",
            "udp://public.popcorn-tracker.org:6969/announce",
            "udp://tracker.dler.org:6969/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://open.demonii.com:1337/announce"
        ]
        dht_bootstrap = [
            ("router.bittorrent.com", 6881),
            ("dht.transmissionbt.com", 6881),
            ("router.utorrent.com", 6881),
            ("dht.libtorrent.org", 25401)
        ]

        for host, port in dht_bootstrap:
            ses.add_dht_node((host, port))

        temp_torrent_path = None
        if torrent_source.startswith("magnet:?"):
            params = lt.parse_magnet_uri(torrent_source)
            params.save_path = dest_dir
            existing_trackers = set(getattr(params, "trackers", []))
            for tr in default_trackers:
                existing_trackers.add(tr)
            params.trackers = list(existing_trackers)
            handle = ses.add_torrent(params)
        elif os.path.isfile(torrent_source):
            info = lt.torrent_info(torrent_source)
            params = lt.add_torrent_params()
            params.ti = info
            params.save_path = dest_dir
            existing = {t.url for t in info.trackers()} if hasattr(info, "trackers") else set()
            for tr in default_trackers:
                existing.add(tr)
            params.trackers = list(existing)
            handle = ses.add_torrent(params)
        elif torrent_source.startswith("http://") or torrent_source.startswith("https://"):
            temp_torrent_path = os.path.join(dest_dir, f"{app_id}_temp.torrent")
            context.temp_files.append(temp_torrent_path)
            context.emit_progress(app_id, "preparing", 14.0, status_text="Descargando manifiesto de instalación...")
            r = requests.get(torrent_source, timeout=30)
            r.raise_for_status()
            with open(temp_torrent_path, "wb") as f:
                f.write(r.content)
            info = lt.torrent_info(temp_torrent_path)
            params = lt.add_torrent_params()
            params.ti = info
            params.save_path = dest_dir
            existing = {t.url for t in info.trackers()} if hasattr(info, "trackers") else set()
            for tr in default_trackers:
                existing.add(tr)
            params.trackers = list(existing)
            handle = ses.add_torrent(params)
        else:
            raise ValueError(f"Fuente de descarga inválida: {torrent_source}")

        def log_libtorrent_alerts(session):
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

        # Wait for metadata if necessary (timeout after 45 seconds if no peers/trackers answer)
        meta_start = time.time()
        METADATA_TIMEOUT_SECONDS = 45.0
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

        target_path = os.path.join(dest_dir, torrent_name)
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
                seeds = max(int(getattr(s, "num_seeds", 0) or 0), int(getattr(s, "list_seeds", 0) or 0))
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
