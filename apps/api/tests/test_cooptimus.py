import httpx

from app.cooptimus import detail_metadata


def test_cooptimus_detail_fetch_uses_exact_id_and_cache(tmp_path):
    calls = []
    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, text="<games><game><steam>10</steam><local>4</local><online>8</online></game></games>")
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        first = detail_metadata(10, client, tmp_path)
        second = detail_metadata(10, client, tmp_path)
    assert len(calls) == 1
    assert first == second
    assert first["local_players_max"] == 4
    assert first["state"] == "ready"


def test_cooptimus_block_does_not_invent_player_numbers(tmp_path):
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403))) as client:
        result = detail_metadata(10, client, tmp_path)
    assert result["state"] == "unavailable"
    assert "local_players_max" not in result
