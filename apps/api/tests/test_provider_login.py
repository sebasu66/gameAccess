import base64
import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, Request
from sqlmodel import Session, SQLModel, create_engine

from app import main as core
from app.access_keys import AccessKey, digest
from app.account_roster import SteamCredential
from app.credential_transport import ALGORITHM, download_transport_aad, transport_aad


def _transport_request():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_der = private_key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_key, core.SteamLoginTransportRequest(
        client_public_key=base64.b64encode(public_der).decode("ascii")
    )

def _remote_request(token: str, installation_id: str) -> Request:
    return Request(
        {
            "type": "http",
            "client": ("192.0.2.1", 1234),
            "headers": [
                (b"authorization", f"Bearer {token}".encode("ascii")),
                (b"x-gameaccess-installation", installation_id.encode("ascii")),
            ],
        }
    )


def test_remote_login_returns_only_encrypted_active_lease_credential(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'login.db'}")
    SQLModel.metadata.create_all(engine)
    now = core.now_utc()
    installation_id = str(uuid4())
    session_token = "provider-transport-test-session-token"
    request = _remote_request(session_token, installation_id)

    with Session(engine) as session:
        session.add(
            AccessKey(
                key_hash=digest("unused-activation-key"),
                duration_hours=1,
                created_at=now,
                key_expires_at=now + timedelta(hours=1),
                activated_at=now,
                expires_at=now + timedelta(hours=1),
                installation_id=installation_id,
                session_hash=digest(session_token),
            )
        )
        account = core.ProviderAccount(
            label="test-provider",
            notes='{"user_id32":123}',
        )
        session.add(account)
        session.commit()
        lease = core.Lease(
            user_id=1,
            game_id=1,
            account_id=account.id,
            starts_at=now,
            expires_at=now + timedelta(minutes=5),
            credits_spent=0,
        )
        session.add(lease)
        session.commit()
        session.refresh(lease)
        session.add(
            core.LeaseCredentialGrant(
                lease_id=lease.id,
                installation_id=installation_id,
                created_at=now,
            )
        )
        session.commit()

        private_key, transport = _transport_request()
        with patch(
            "app.account_roster.credential_for_label",
            return_value=SteamCredential(
                "test-provider",
                "test-login",
                "test-password",
            ),
        ):
            response = core.lease_steam_login(
                lease.id,
                transport,
                request,
                session,
            )

        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert b"test-login" not in response.body
        assert b"test-password" not in response.body

        envelope = json.loads(response.body)
        assert envelope["alg"] == ALGORITHM
        data_key = private_key.decrypt(
            base64.b64decode(envelope["encryptedKey"]),
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )
        plaintext = AESGCM(data_key).decrypt(
            base64.b64decode(envelope["nonce"]),
            base64.b64decode(envelope["ciphertext"]),
            transport_aad(lease.id, installation_id),
        )
        payload = json.loads(plaintext)
        assert payload == {
            "accountName": "test-login",
            "password": "test-password",
            "expectedUserId32": 123,
        }

        other_installation_id = str(uuid4())
        other_token = "other-valid-installation-session-token"
        session.add(
            AccessKey(
                key_hash=digest("other-unused-activation-key"),
                duration_hours=1,
                created_at=now,
                key_expires_at=now + timedelta(hours=1),
                activated_at=now,
                expires_at=now + timedelta(hours=1),
                installation_id=other_installation_id,
                session_hash=digest(other_token),
            )
        )
        session.commit()
        _, other_transport = _transport_request()
        with pytest.raises(HTTPException) as exc:
            core.lease_steam_login(
                lease.id,
                other_transport,
                _remote_request(other_token, other_installation_id),
                session,
            )
        assert exc.value.status_code == 403

        lease.expires_at = core.now_utc() - timedelta(seconds=1)
        session.add(lease)
        session.commit()
        _, expired_transport = _transport_request()
        with pytest.raises(HTTPException) as exc:
            core.lease_steam_login(
                lease.id,
                expired_transport,
                request,
                session,
            )
        assert exc.value.status_code == 409


def test_remote_login_requires_valid_activation(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'login-auth.db'}")
    SQLModel.metadata.create_all(engine)
    private_key, transport = _transport_request()
    del private_key
    unauthenticated = Request(
        {
            "type": "http",
            "client": ("192.0.2.1", 1234),
            "headers": [
                (b"x-gameaccess-installation", str(uuid4()).encode("ascii")),
            ],
        }
    )
    with Session(engine) as session:
        with pytest.raises(HTTPException) as exc:
            core.lease_steam_login(1, transport, unauthenticated, session)
        assert exc.value.status_code == 401


def test_remote_download_credential_is_encrypted_and_server_selected(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'download-login.db'}")
    SQLModel.metadata.create_all(engine)
    now = core.now_utc()
    installation_id = str(uuid4())
    session_token = "download-provider-transport-session-token"
    request = _remote_request(session_token, installation_id)

    with Session(engine) as session:
        session.add(
            AccessKey(
                key_hash=digest("unused-download-activation-key"),
                duration_hours=1,
                created_at=now,
                key_expires_at=now + timedelta(hours=1),
                activated_at=now,
                expires_at=now + timedelta(hours=1),
                installation_id=installation_id,
                session_hash=digest(session_token),
            )
        )
        game = core.Game(slug="portal-test", name="Portal Test", app_id=400)
        account = core.ProviderAccount(
            label="download-provider",
            notes='{"user_id32":456}',
        )
        session.add(game)
        session.add(account)
        session.commit()
        session.refresh(game)
        session.refresh(account)
        session.add(core.AccountGame(account_id=account.id, game_id=game.id))
        session.commit()

        private_key, transport = _transport_request()
        with (
            patch(
                "app.family_capacity.select_best_account",
                return_value={"account": account},
            ),
            patch(
                "app.account_roster.credential_for_label",
                return_value=SteamCredential(
                    "download-provider",
                    "download-login",
                    "download-password",
                ),
            ),
        ):
            response = core.download_steam_login(
                400,
                transport,
                request,
                session,
            )

        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert b"download-login" not in response.body
        assert b"download-password" not in response.body

        envelope = json.loads(response.body)
        data_key = private_key.decrypt(
            base64.b64decode(envelope["encryptedKey"]),
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )
        plaintext = AESGCM(data_key).decrypt(
            base64.b64decode(envelope["nonce"]),
            base64.b64decode(envelope["ciphertext"]),
            download_transport_aad(400, installation_id),
        )
        assert json.loads(plaintext) == {
            "providerId": "download-provider",
            "accountName": "download-login",
            "password": "download-password",
            "expectedUserId32": 456,
        }


def test_download_reuses_same_installation_active_lease_account(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'same-install-download.db'}")
    SQLModel.metadata.create_all(engine)
    now = core.now_utc()
    installation_id = str(uuid4())
    session_token = "same-install-download-session-token"
    request = _remote_request(session_token, installation_id)

    with Session(engine) as session:
        session.add(
            AccessKey(
                key_hash=digest("unused-same-install-key"),
                duration_hours=1,
                created_at=now,
                key_expires_at=now + timedelta(hours=1),
                activated_at=now,
                expires_at=now + timedelta(hours=1),
                installation_id=installation_id,
                session_hash=digest(session_token),
            )
        )
        game = core.Game(slug="same-install-game", name="Same Install Game", app_id=282800)
        account = core.ProviderAccount(
            label="same-install-provider",
            status=core.AccountStatus.leased,
            notes='{"user_id32":789,"accessible_app_ids":[282800]}',
        )
        session.add(game)
        session.add(account)
        session.commit()
        session.refresh(game)
        session.refresh(account)

        lease = core.Lease(
            user_id=1,
            game_id=game.id,
            account_id=account.id,
            starts_at=now,
            expires_at=now + timedelta(minutes=10),
            credits_spent=0,
        )
        session.add(lease)
        session.commit()
        session.refresh(lease)
        session.add(
            core.LeaseCredentialGrant(
                lease_id=lease.id,
                installation_id=installation_id,
                created_at=now,
            )
        )
        session.commit()

        private_key, transport = _transport_request()
        with (
            patch("app.family_capacity.select_best_account", return_value=None),
            patch(
                "app.account_roster.credential_for_label",
                return_value=SteamCredential(
                    "same-install-provider",
                    "same-install-login",
                    "same-install-password",
                ),
            ),
        ):
            response = core.download_steam_login(
                282800,
                transport,
                request,
                session,
            )

        assert response.status_code == 200
        envelope = json.loads(response.body)
        data_key = private_key.decrypt(
            base64.b64decode(envelope["encryptedKey"]),
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )
        plaintext = AESGCM(data_key).decrypt(
            base64.b64decode(envelope["nonce"]),
            base64.b64decode(envelope["ciphertext"]),
            download_transport_aad(282800, installation_id),
        )
        payload = json.loads(plaintext)
        assert payload["providerId"] == "same-install-provider"


def test_download_does_not_reuse_other_installations_active_lease(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'other-install-download.db'}")
    SQLModel.metadata.create_all(engine)
    now = core.now_utc()
    installation_id = str(uuid4())
    other_installation_id = str(uuid4())
    session_token = "requesting-download-session-token"
    request = _remote_request(session_token, installation_id)

    with Session(engine) as session:
        session.add(
            AccessKey(
                key_hash=digest("unused-requesting-install-key"),
                duration_hours=1,
                created_at=now,
                key_expires_at=now + timedelta(hours=1),
                activated_at=now,
                expires_at=now + timedelta(hours=1),
                installation_id=installation_id,
                session_hash=digest(session_token),
            )
        )
        game = core.Game(slug="other-install-game", name="Other Install Game", app_id=400)
        account = core.ProviderAccount(
            label="other-install-provider",
            status=core.AccountStatus.leased,
            notes='{"user_id32":456,"accessible_app_ids":[400]}',
        )
        session.add(game)
        session.add(account)
        session.commit()
        session.refresh(game)
        session.refresh(account)

        lease = core.Lease(
            user_id=1,
            game_id=game.id,
            account_id=account.id,
            starts_at=now,
            expires_at=now + timedelta(minutes=10),
            credits_spent=0,
        )
        session.add(lease)
        session.commit()
        session.refresh(lease)
        session.add(
            core.LeaseCredentialGrant(
                lease_id=lease.id,
                installation_id=other_installation_id,
                created_at=now,
            )
        )
        session.commit()

        _, transport = _transport_request()
        with patch("app.family_capacity.select_best_account", return_value=None):
            with pytest.raises(HTTPException) as exc:
                core.download_steam_login(
                    400,
                    transport,
                    request,
                    session,
                )
        assert exc.value.status_code == 409
