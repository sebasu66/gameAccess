from __future__ import annotations

import base64
import json
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ALGORITHM = "RSA-OAEP-256+A256GCM"
_CONTEXT = "gameaccess-provider-login-v1"
_DOWNLOAD_CONTEXT = "gameaccess-provider-download-v1"


def transport_aad(lease_id: int, installation_id: str) -> bytes:
    return f"{_CONTEXT}|{lease_id}|{installation_id}".encode("utf-8")


def download_transport_aad(app_id: int, installation_id: str) -> bytes:
    return f"{_DOWNLOAD_CONTEXT}|{app_id}|{installation_id}".encode("utf-8")


def _public_key(encoded: str) -> rsa.RSAPublicKey:
    try:
        raw = base64.b64decode(encoded.encode("ascii"), validate=True)
        key = serialization.load_der_public_key(raw)
    except (ValueError, TypeError) as exc:
        raise ValueError("Invalid provider credential transport key") from exc
    if not isinstance(key, rsa.RSAPublicKey):
        raise ValueError("Provider credential transport requires an RSA public key")
    if key.key_size < 2048 or key.key_size > 4096:
        raise ValueError("Provider credential transport key size is not allowed")
    return key


def encrypt_provider_credential(
    client_public_key: str,
    *,
    lease_id: int,
    installation_id: str,
    account_name: str,
    password: str,
    expected_user_id32: int,
) -> dict[str, str]:
    public_key = _public_key(client_public_key)
    payload = json.dumps(
        {
            "accountName": account_name,
            "password": password,
            "expectedUserId32": int(expected_user_id32),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    data_key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    ciphertext = AESGCM(data_key).encrypt(
        nonce,
        payload,
        transport_aad(lease_id, installation_id),
    )
    encrypted_key = public_key.encrypt(
        data_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return {
        "alg": ALGORITHM,
        "encryptedKey": base64.b64encode(encrypted_key).decode("ascii"),
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }


def encrypt_provider_download_credential(
    client_public_key: str,
    *,
    app_id: int,
    installation_id: str,
    provider_id: str,
    account_name: str,
    password: str,
    expected_user_id32: int,
) -> dict[str, str]:
    public_key = _public_key(client_public_key)
    payload = json.dumps(
        {
            "providerId": provider_id,
            "accountName": account_name,
            "password": password,
            "expectedUserId32": int(expected_user_id32),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    data_key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    ciphertext = AESGCM(data_key).encrypt(
        nonce,
        payload,
        download_transport_aad(app_id, installation_id),
    )
    encrypted_key = public_key.encrypt(
        data_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return {
        "alg": ALGORITHM,
        "encryptedKey": base64.b64encode(encrypted_key).decode("ascii"),
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }
