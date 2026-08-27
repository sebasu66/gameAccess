"""Read Steam's local package cache to map license/package IDs to AppIDs.

Why this exists:
`userdata/<id>/config/localconfig.vdf` has an `Apps` section, but those entries
are *accessible/known* apps for that Steam user. With Steam Families the same
shared game can appear in several family members' `Apps` sections even though
only one member owns the license. Therefore `Apps` must never be counted as
copies/licenses.

Steam's `Licenses` section is keyed by package/subscription ID. We read only
those numeric keys (never the license values) in ``steam_pool.py`` and resolve
them through ``appcache/packageinfo.vdf`` here. ``packageinfo.vdf`` is a local
catalog cache; it contains package metadata, not account passwords/session
credentials.

The package container layout follows ValveResourceFormat/SteamAppInfo and its
KeyValues1 binary reader. This module intentionally exposes only
``package_id -> app_ids``.
"""

from __future__ import annotations

import io
import struct
from pathlib import Path
from typing import Any, BinaryIO

# PackageInfo versions currently documented/used by Steam.
PACKAGE_VERSION_MIN = 39
PACKAGE_VERSION_MAX = 40
PACKAGE_FOOTER = 0xFFFFFFFF

# KeyValues1 binary node types.
KV_CHILD = 0
KV_STRING = 1
KV_INT32 = 2
KV_FLOAT32 = 3
KV_POINTER = 4
KV_WSTRING = 5
KV_COLOR = 6
KV_UINT64 = 7
KV_END = 8
KV_BINARY = 9
KV_INT64 = 10
KV_ALT_END = 11
KV_MAGIC = 0x564B4256  # "VBKV" as read by ValveKeyValue


class PackageInfoError(ValueError):
    pass


def _read_exact(stream: BinaryIO, count: int) -> bytes:
    data = stream.read(count)
    if len(data) != count:
        raise EOFError("truncated packageinfo.vdf")
    return data


def _u32(stream: BinaryIO) -> int:
    return struct.unpack("<I", _read_exact(stream, 4))[0]


def _u64(stream: BinaryIO) -> int:
    return struct.unpack("<Q", _read_exact(stream, 8))[0]


def _cstring(stream: BinaryIO) -> str:
    chunks = bytearray()
    while True:
        byte = stream.read(1)
        if not byte:
            raise EOFError("unterminated KV1 string")
        if byte == b"\x00":
            return chunks.decode("utf-8", errors="replace")
        chunks.extend(byte)


def _wstring(stream: BinaryIO) -> str:
    chunks = bytearray()
    while True:
        pair = _read_exact(stream, 2)
        if pair == b"\x00\x00":
            return chunks.decode("utf-16-le", errors="replace")
        chunks.extend(pair)


def _read_object(stream: BinaryIO, end_marker: int) -> dict[str, Any]:
    result: dict[str, Any] = {}
    while True:
        raw_type = stream.read(1)
        if not raw_type:
            raise EOFError("truncated KV1 object")
        node_type = raw_type[0]
        if node_type == end_marker:
            return result
        key = _cstring(stream)
        result[key] = _read_value(stream, node_type, end_marker)


def _read_value(stream: BinaryIO, node_type: int, end_marker: int) -> Any:
    if node_type == KV_CHILD:
        return _read_object(stream, end_marker)
    if node_type == KV_STRING:
        return _cstring(stream)
    if node_type in (KV_INT32, KV_COLOR, KV_POINTER):
        return struct.unpack("<i", _read_exact(stream, 4))[0]
    if node_type == KV_FLOAT32:
        return struct.unpack("<f", _read_exact(stream, 4))[0]
    if node_type == KV_WSTRING:
        return _wstring(stream)
    if node_type == KV_UINT64:
        return _u64(stream)
    if node_type == KV_INT64:
        return struct.unpack("<q", _read_exact(stream, 8))[0]
    if node_type == KV_BINARY:
        # ValveKeyValue itself deliberately treats type 9 as unsupported because
        # it has no generally valid length framing in KV1. PackageInfo is not
        # expected to use it; failing closed is safer than desynchronizing the
        # stream and inventing ownership.
        raise PackageInfoError("unsupported KV1 node type 9 in packageinfo.vdf")
    raise PackageInfoError(f"unsupported KV1 node type {node_type}")


def _read_kv1_document(stream: BinaryIO) -> dict[str, Any]:
    """Read exactly one binary KV1 document and leave the stream at next entry."""
    end_marker = KV_END
    start = stream.tell()
    probe = stream.read(4)
    if len(probe) != 4:
        raise EOFError("truncated KV1 package data")
    if struct.unpack("<I", probe)[0] == KV_MAGIC:
        _read_exact(stream, 4)  # crc32
        end_marker = KV_ALT_END
    else:
        stream.seek(start)

    raw_type = stream.read(1)
    if not raw_type:
        raise EOFError("missing KV1 root node")
    node_type = raw_type[0]
    if node_type == end_marker:
        return {}

    root_name = _cstring(stream)
    root_value = _read_value(stream, node_type, end_marker)

    trailer = stream.read(1)
    if not trailer or trailer[0] != end_marker:
        raise PackageInfoError("invalid KV1 root terminator in packageinfo.vdf")

    # Keep the root name because package data is normally keyed by package id.
    return {root_name: root_value}


def _to_positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    text = str(value).strip()
    if text.isdigit():
        number = int(text)
        return number if number > 0 else None
    return None


def _app_ids_from_package(document: Any) -> set[int]:
    """Find app IDs in the package's `appids` object without exposing other data."""
    found: set[int] = set()

    def visit(node: Any) -> None:
        if not isinstance(node, dict):
            return
        for key, value in node.items():
            if str(key).casefold() == "appids" and isinstance(value, dict):
                # Steam package data normally stores {"0":"appid", ...}.
                for child_key, child_value in value.items():
                    number = _to_positive_int(child_value)
                    if number is not None:
                        found.add(number)
                # Defensive fallback for a possible {"appid":"1"} shape.
                if not found:
                    for child_key in value:
                        number = _to_positive_int(child_key)
                        if number is not None and number > 10:
                            found.add(number)
            visit(value)

    visit(document)
    return found


def _package_version(magic: int) -> int:
    version = magic & 0xFF
    prefix = magic >> 8
    # ValveResourceFormat's parser checks 0x065655 after shifting; some public
    # format notes spell the historical bytes as 0x065556. Accept both known
    # spellings but still require package versions 39/40.
    if version not in range(PACKAGE_VERSION_MIN, PACKAGE_VERSION_MAX + 1):
        raise PackageInfoError(f"unsupported packageinfo version {version}")
    if prefix not in (0x065655, 0x065556):
        raise PackageInfoError(f"unknown packageinfo magic 0x{magic:08x}")
    return version


def read_package_app_map(
    path: Path,
    wanted_package_ids: set[int] | None = None,
) -> tuple[dict[int, set[int]], set[int]]:
    """Return resolved package->AppIDs and requested package IDs not in the cache."""
    wanted = set(wanted_package_ids or ())
    resolved: dict[int, set[int]] = {}

    with path.open("rb") as stream:
        version = _package_version(_u32(stream))
        _u32(stream)  # universe

        while True:
            package_id = _u32(stream)
            if package_id == PACKAGE_FOOTER:
                break
            _read_exact(stream, 20)  # package hash
            _u32(stream)  # change number
            if version >= 40:
                _u64(stream)  # PICS token; catalog metadata, never emitted

            document = _read_kv1_document(stream)
            if not wanted or package_id in wanted:
                resolved[package_id] = _app_ids_from_package(document)

    unresolved = wanted - set(resolved)
    return resolved, unresolved


def resolve_owned_apps(path: Path, package_ids: set[int]) -> tuple[set[int], set[int]]:
    """Resolve account package IDs to owned AppIDs; unresolved IDs fail closed."""
    if not package_ids:
        return set(), set()
    mapping, unresolved = read_package_app_map(path, package_ids)
    apps: set[int] = set()
    for package_id in package_ids:
        apps.update(mapping.get(package_id, set()))
    return apps, unresolved
