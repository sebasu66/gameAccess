import json

from app import access_overrides


def _clear_courtesy_env(monkeypatch) -> None:
    for name in (
        "GAMEACCESS_COURTESY_KEYS",
        "GAMEACCESS_COURTESY_KEY",
        "GAMEACCESS_COURTESY_KEYS_FILE",
        "GAMEACCESS_COURTESY_DURATION_MONTHS",
    ):
        monkeypatch.delenv(name, raising=False)


def test_courtesy_key_can_come_directly_from_secret_variable(monkeypatch) -> None:
    _clear_courtesy_env(monkeypatch)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEY", "GA-COURTESY-TEST-1234")

    keys = access_overrides._configured_keys()

    assert len(keys) == 1
    assert keys[0].value == "GA-COURTESY-TEST-1234"
    assert keys[0].duration_months == 1


def test_courtesy_json_can_come_from_secret_variable(monkeypatch) -> None:
    _clear_courtesy_env(monkeypatch)
    monkeypatch.setenv(
        "GAMEACCESS_COURTESY_KEYS",
        json.dumps(
            {
                "keys": [
                    {
                        "name": "beta",
                        "key": "GA-COURTESY-BETA-1234",
                        "duration_months": 2,
                    }
                ]
            }
        ),
    )

    keys = access_overrides._configured_keys()

    assert [(key.name, key.value, key.duration_months) for key in keys] == [
        ("beta", "GA-COURTESY-BETA-1234", 2)
    ]


def test_legacy_file_variable_accepts_direct_secret_value(monkeypatch) -> None:
    _clear_courtesy_env(monkeypatch)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", "GA-COURTESY-LEGACY-1234")

    keys = access_overrides._configured_keys()

    assert len(keys) == 1
    assert keys[0].value == "GA-COURTESY-LEGACY-1234"


def test_legacy_file_path_still_works(monkeypatch, tmp_path) -> None:
    _clear_courtesy_env(monkeypatch)
    path = tmp_path / "courtesy-keys.json"
    path.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "name": "local",
                        "key": "GA-COURTESY-LOCAL-1234",
                        "duration_months": 1,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    keys = access_overrides._configured_keys()

    assert len(keys) == 1
    assert keys[0].name == "local"
    assert keys[0].value == "GA-COURTESY-LOCAL-1234"


def test_missing_path_is_not_treated_as_access_key(monkeypatch, tmp_path) -> None:
    _clear_courtesy_env(monkeypatch)
    path = tmp_path / "missing.json"
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    assert access_overrides._configured_keys() == []
