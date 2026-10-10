import httpx
from app.cooptimus import detail_metadata,public_features

def test_public_search_follows_pc_page_then_checks_steam_link(tmp_path):
    calls=[]
    def handler(request):
        calls.append(str(request.url))
        if "/ajax/" in request.url.path:
            return httpx.Response(200,text='<a href="/game/6218/pc/it-takes-two.html">Game</a>')
        return httpx.Response(200,text='<a href="http://store.steampowered.com/app/1426210/">Steam</a><dl><dt>Local Co-Op</dt><dd>2 Players</dd><dt>Online Co-Op</dt><dd>2 Players</dd><dt>LAN Play or System Link</dt><dd>Not Supported</dd></dl>')
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        data=detail_metadata(1426210,client,tmp_path,name="It Takes Two")
    assert data["state"]=="ready" and data["local_players_max"]==2
    assert data["lan_players_max"]==0
    assert "game-title-filter=It+Takes+Two" in calls[0]
    assert len(calls)==2

def test_public_page_cannot_enrich_another_steam_game():
    assert public_features('<a href="https://store.steampowered.com/app/12/">Steam</a>Local Co-Op 4 Players',13) is None

def test_refresh_keeps_last_verified_detail_when_upstream_blocks(tmp_path):
    path=tmp_path/"12.json"
    path.write_text('{"cached_at":0,"data":{"app_id":12,"state":"ready","local_players_max":2}}')
    with httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(403))) as client:
        result=detail_metadata(12,client,tmp_path,refresh=True)
    assert result["stale"] and result["local_players_max"]==2
