"""Optional configured debrid transport; no source list ownership."""
from __future__ import annotations
import os
from typing import Optional, Dict, Any
import requests

class TorboxClient:
    BASE_URL = "https://api.torbox.app/v1/api"

    def __init__(self, api_key: str):
        self.api_key = api_key.strip()
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "GameAccess/1.0.0"
        })

    def check_cached(self, link_or_hash: str) -> bool:
        url = f"{self.BASE_URL}/torrents/checkcached"
        params = {"format": "list"}
        if link_or_hash.startswith("magnet:"):
            params["link"] = link_or_hash
        else:
            params["hash"] = link_or_hash
        try:
            r = self.session.get(url, params=params, timeout=10)
            if r.ok:
                data = r.json()
                return data.get("data") is True or bool(data.get("data"))
        except Exception:
            pass
        return False

    def add_torrent(self, torrent_input: str) -> int:
        url = f"{self.BASE_URL}/torrents/createentry"
        if torrent_input.startswith("magnet:?"):
            data = {"magnet": torrent_input, "seed": 1, "allow_zip": "true"}
            r = self.session.post(url, data=data, timeout=30)
        elif os.path.isfile(torrent_input):
            with open(torrent_input, "rb") as f:
                files = {"file": (os.path.basename(torrent_input), f, "application/x-bittorrent")}
                data = {"seed": 1, "allow_zip": "true"}
                r = self.session.post(url, data=data, files=files, timeout=60)
        elif torrent_input.startswith("http://") or torrent_input.startswith("https://"):
            data = {"link": torrent_input, "seed": 1, "allow_zip": "true"}
            r = self.session.post(url, data=data, timeout=30)
        else:
            raise ValueError(f"Fuente de torrent inválida: {torrent_input}")

        if not r.ok:
            raise RuntimeError(f"TorBox API error ({r.status_code}): {r.text}")

        res = r.json()
        if not res.get("success"):
            raise RuntimeError(f"TorBox rechazó el torrent: {res.get('detail', res)}")

        return int(res["data"]["torrent_id"])

    def get_status(self, torrent_id: int) -> Optional[Dict[str, Any]]:
        url = f"{self.BASE_URL}/torrents/mylist"
        params = {"id": torrent_id, "bypass_cache": "true"}
        r = self.session.get(url, params=params, timeout=15)
        if not r.ok:
            return None
        res = r.json()
        data = res.get("data")
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict):
            return data
        return None

    def request_link(self, torrent_id: int, file_id: Optional[int] = None, zip_link: bool = True) -> str:
        url = f"{self.BASE_URL}/torrents/requestdl"
        params = {
            "token": self.api_key,
            "torrent_id": torrent_id,
            "zip_link": "true" if zip_link else "false",
            "zip": "true" if zip_link else "false",
        }
        if file_id is not None and not zip_link:
            params["file_id"] = file_id

        r = self.session.get(url, params=params, timeout=30)
        if not r.ok:
            raise RuntimeError(f"No se pudo obtener enlace de descarga de TorBox: {r.status_code}")
        res = r.json()
        link = res.get("data")
        if not link or not isinstance(link, str):
            raise RuntimeError(f"Respuesta de enlace inválida: {res}")
        return link
