"""Minimal reader for Steam's local appcache/appinfo.vdf (v41).

Used by gameAccess only to map AppID -> public catalog metadata such as name and
app type. This file never contains account credentials or session material.

The v41 layout and binary-VDF details follow the public documentation/examples
from ValveResourceFormat/SteamAppInfo and danielknng/steam-appinfo-parser (MIT).
This implementation is intentionally small and only exposes fields gameAccess
needs for local catalog discovery.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any, Iterator

MAGIC_V41 = b"\x29\x44\x56\x07"
FIXED_HEADER_BYTES = 60

TYPE_DICT = 0x00
TYPE_STRING = 0x01
TYPE_INT32 = 0x02
TYPE_FLOAT32 = 0x03
TYPE_PTR = 0x04
TYPE_WSTRING = 0x05
TYPE_COLOR = 0x06
TYPE_UINT64 = 0x07
TYPE_END = 0x08
TYPE_INT64 = 0x0A


def _load_string_table(data: bytes, offset: int) -> list[str]:
    if offset + 4 > len(data):
        raise ValueError("Steam appinfo string table offset is invalid")
    count = struct.unpack_from("<I", data, offset)[0]
    pos = offset + 4
    values: list[str] = []
    for _ in range(count):
        end = data.find(b"\x00", pos)
        if end < 0:
            raise ValueError("Steam appinfo string table is truncated")
        values.append(data[pos:end].decode("utf-8", errors="replace"))
        pos = end + 1
    return values


def _read_wstring(data: bytes, pos: int, end: int) -> tuple[str, int]:
    cursor = pos
    while cursor + 1 < end:
        if data[cursor : cursor + 2] == b"\x00\x00":
            raw = data[pos:cursor]
            if len(raw) % 2:
                raw += b"\x00"
            return raw.decode("utf-16-le", errors="replace"), cursor + 2
        cursor += 2
    return "", end


def _read_bvdf(data: bytes, pos: int, end: int, strings: list[str]) -> tuple[dict[str, Any], int]:
    result: dict[str, Any] = {}
    while pos < end:
        type_byte = data[pos]
        pos += 1
        if type_byte == TYPE_END:
            break
        if pos + 4 > end:
            break
        key_index = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        key = strings[key_index] if key_index < len(strings) else f"?{key_index}"

        if type_byte == TYPE_DICT:
            value, pos = _read_bvdf(data, pos, end, strings)
        elif type_byte == TYPE_STRING:
            nul = data.find(b"\x00", pos, end)
            if nul < 0:
                return result, end
            value = data[pos:nul].decode("utf-8", errors="replace")
            pos = nul + 1
        elif type_byte == TYPE_INT32:
            if pos + 4 > end:
                return result, end
            value = struct.unpack_from("<i", data, pos)[0]
            pos += 4
        elif type_byte == TYPE_FLOAT32:
            if pos + 4 > end:
                return result, end
            value = struct.unpack_from("<f", data, pos)[0]
            pos += 4
        elif type_byte in (TYPE_PTR, TYPE_COLOR):
            if pos + 4 > end:
                return result, end
            value = struct.unpack_from("<I", data, pos)[0]
            pos += 4
        elif type_byte == TYPE_UINT64:
            if pos + 8 > end:
                return result, end
            value = struct.unpack_from("<Q", data, pos)[0]
            pos += 8
        elif type_byte == TYPE_INT64:
            if pos + 8 > end:
                return result, end
            value = struct.unpack_from("<q", data, pos)[0]
            pos += 8
        elif type_byte == TYPE_WSTRING:
            value, pos = _read_wstring(data, pos, end)
        else:
            return result, end
        result[key] = value
    return result, pos


def iter_appinfo(data: bytes) -> Iterator[dict[str, Any]]:
    if len(data) < 16 or data[:4] != MAGIC_V41:
        magic = data[:4].hex() if data else "<empty>"
        raise ValueError(f"Unsupported Steam appinfo.vdf format: {magic}")

    table_offset = struct.unpack_from("<Q", data, 8)[0]
    if table_offset <= 16 or table_offset > len(data):
        raise ValueError("Steam appinfo.vdf string table offset is invalid")
    strings = _load_string_table(data, table_offset)

    pos = 16
    while pos + 4 <= table_offset:
        app_id = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        if app_id == 0:
            break
        if pos + 4 > table_offset:
            break
        size = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        entry_payload_start = pos
        if pos + FIXED_HEADER_BYTES > table_offset:
            break

        pos += 4  # info_state
        last_updated = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        pos += 8  # access token (catalog cache metadata, not emitted)
        pos += 20  # CDN sha1
        change_number = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        pos += 20  # data sha1

        vdf_size = size - FIXED_HEADER_BYTES
        vdf_end = pos + max(0, vdf_size)
        if vdf_size <= 0 or vdf_end > table_offset:
            pos = entry_payload_start + max(size, 0)
            continue

        try:
            raw, _ = _read_bvdf(data, pos, vdf_end, strings)
        except Exception:
            pos = vdf_end
            continue
        appinfo = raw.get("appinfo", {}) if isinstance(raw, dict) else {}
        common = appinfo.get("common", {}) if isinstance(appinfo, dict) else {}
        extended = appinfo.get("extended", {}) if isinstance(appinfo, dict) else {}
        if not isinstance(common, dict):
            common = {}
        if not isinstance(extended, dict):
            extended = {}
        yield {
            "app_id": app_id,
            "name": str(common.get("name") or "").strip(),
            "type": str(common.get("type") or "").strip().casefold(),
            "oslist": str(common.get("oslist") or "").strip(),
            "developer": str(extended.get("developer") or "").strip(),
            "publisher": str(extended.get("publisher") or "").strip(),
            "last_updated": last_updated,
            "change_number": change_number,
        }
        pos = vdf_end


def read_local_app_catalog(path: Path, app_ids: set[int] | None = None) -> dict[int, dict[str, Any]]:
    data = path.read_bytes()
    wanted = app_ids if app_ids is not None else None
    result: dict[int, dict[str, Any]] = {}
    for item in iter_appinfo(data):
        app_id = int(item["app_id"])
        if wanted is not None and app_id not in wanted:
            continue
        result[app_id] = item
        if wanted is not None and len(result) >= len(wanted):
            break
    return result
