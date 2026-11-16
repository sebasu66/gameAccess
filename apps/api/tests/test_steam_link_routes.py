import httpx
from fastapi.testclient import TestClient

from app import main, steam_link_routes as link

client = TestClient(main.app)
STEAM_ID = "76561198000000001"


def signed(state: str, base: str = "http://testserver", **changes) -> dict:
    claimed = f"https://steamcommunity.com/openid/id/{STEAM_ID}"
    params = {"openid.ns": link.OPENID_NS, "openid.mode": "id_res", "openid.op_endpoint": link.STEAM_OPENID,
              "openid.claimed_id": claimed, "openid.identity": claimed, "openid.return_to": f"{base}/steam/link/callback?state={state}",
              "openid.response_nonce": "2026-11-16T00:00:00Zabc", "openid.assoc_handle": "1234567890",
              "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle", "openid.sig": "x"}
    return {**params, **changes}


def steam_says(valid: bool, seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=f"ns:{link.OPENID_NS}\nis_valid:{'true' if valid else 'false'}\n")
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_start_gives_a_one_time_address_that_goes_to_steams_sign_in():
    started = client.post("/steam/link/start").json()
    assert started["url"].endswith(f"/steam/link/go/{started['state']}")
    went = client.get(f"/steam/link/go/{started['state']}", follow_redirects=False)
    assert went.status_code == 302 and went.headers["location"].startswith(link.STEAM_OPENID)
    assert "checkid_setup" in went.headers["location"] and "realm=http%3A%2F%2Ftestserver" in went.headers["location"]
    assert client.get(f"/steam/link/result/{started['state']}").json()["status"] == "pending"


def test_steam_must_confirm_the_answer_and_it_must_be_for_this_server():
    seen = []
    state = "s" * 24
    base = "http://testserver/steam/link/callback"
    assert link.verify(signed(state), base, steam_says(True, seen)) == STEAM_ID
    assert b"check_authentication" in seen[0].content
    assert link.verify(signed(state), base, steam_says(False, [])) is None
    assert link.verify(signed(state, base="https://evil.example"), base, steam_says(True, [])) is None
    assert link.verify(signed(state, **{"openid.op_endpoint": "https://evil.example/openid"}), base, steam_says(True, [])) is None
    assert link.verify(signed(state, **{"openid.claimed_id": "https://evil.example/id/1"}), base, steam_says(True, [])) is None


def test_the_result_is_said_once_then_the_state_is_gone(monkeypatch):
    started = client.post("/steam/link/start").json()
    state = started["state"]
    monkeypatch.setattr(link, "verify", lambda params, expected, http: STEAM_ID)
    monkeypatch.setattr(link, "persona", lambda http, steam_id: "Owner")
    page = client.get("/steam/link/callback", params={"state": state, **signed(state)})
    assert page.status_code == 200 and "Owner" in page.text
    assert client.get(f"/steam/link/result/{state}").json() == {"status": "done", "steam_id": STEAM_ID, "persona": "Owner"}
    assert client.get(f"/steam/link/result/{state}").json() == {"status": "expired"}
    # The same answer cannot be used again.
    assert client.get("/steam/link/callback", params={"state": state, **signed(state)}).status_code == 410


def test_a_cancelled_sign_in_links_nothing():
    state = client.post("/steam/link/start").json()["state"]
    client.get("/steam/link/callback", params={"state": state, "openid.mode": "cancel"})
    assert client.get(f"/steam/link/result/{state}").json()["status"] == "cancelled"
