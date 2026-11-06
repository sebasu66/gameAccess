"""Seals a download link for one player, so it never travels or gets logged in plain text.

A TorBox link carries the account's API key, so the server hands it to the player sealed with a key derived
from that player's own session (which both sides already know; the key itself never travels). The player
opens it in memory, downloads, and forgets it. This keeps the link out of responses, logs and caches; it does
not stop someone who inspects their own running client. Standard library only, because the player's bundled
Python has no crypto package: an HMAC-SHA256 key stream encrypts, and a separate HMAC detects tampering.

The same file lives in apps/launcher/game_download_manager/link_sealing.py; keep both identical.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

PURPOSE = b"gameaccess-sealed-link-v1"
NONCE_BYTES = 16
TAG_BYTES = 16


class SealError(ValueError):
    pass


def _keys(session_token: str, installation: str) -> tuple[bytes, bytes]:
    root = hmac.new(session_token.encode("utf-8"), PURPOSE + b"|" + installation.encode("utf-8"), hashlib.sha256).digest()
    return (hmac.new(root, b"encrypt", hashlib.sha256).digest(), hmac.new(root, b"authenticate", hashlib.sha256).digest())


def _stream(key: bytes, nonce: bytes, length: int) -> bytes:
    blocks = (hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest() for counter in range((length + 31) // 32))
    return b"".join(blocks)[:length]


def seal(url: str, session_token: str, installation: str) -> str:
    if not session_token or not installation:
        raise SealError("missing session")
    encrypt_key, auth_key = _keys(session_token, installation)
    nonce = os.urandom(NONCE_BYTES)
    plain = url.encode("utf-8")
    cipher = bytes(a ^ b for a, b in zip(plain, _stream(encrypt_key, nonce, len(plain))))
    tag = hmac.new(auth_key, nonce + cipher, hashlib.sha256).digest()[:TAG_BYTES]
    return base64.urlsafe_b64encode(nonce + cipher + tag).decode("ascii")


def unseal(sealed: str, session_token: str, installation: str) -> str:
    try:
        raw = base64.urlsafe_b64decode(sealed.encode("ascii"))
    except (ValueError, UnicodeError) as exc:
        raise SealError("malformed") from exc
    if len(raw) <= NONCE_BYTES + TAG_BYTES:
        raise SealError("malformed")
    nonce, cipher, tag = raw[:NONCE_BYTES], raw[NONCE_BYTES:-TAG_BYTES], raw[-TAG_BYTES:]
    encrypt_key, auth_key = _keys(session_token, installation)
    if not hmac.compare_digest(tag, hmac.new(auth_key, nonce + cipher, hashlib.sha256).digest()[:TAG_BYTES]):
        raise SealError("not sealed for this session")
    return bytes(a ^ b for a, b in zip(cipher, _stream(encrypt_key, nonce, len(cipher)))).decode("utf-8")
