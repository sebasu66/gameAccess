from app.digital_download_size import annotate_download_sizes, size_bytes


def test_matches_exact_selected_source_not_similar_game_title():
    items = [{"id": 1, "downloadSource": "release-b", "size": "100 GB"}]
    sources = [{"uri": "release-a", "file_size": "20 GB"}, {"uri": "release-b", "file_size": "12.5 GB", "source_url": "provider-json"}]
    result = annotate_download_sizes(items, sources)[0]
    assert result["download_size"] == "12.5 GB"
    assert result["download_size_bytes"] == int(12.5 * 1024**3)
    assert result["download_size_source"] == "provider-json"
    assert "download_size" not in items[0]


def test_missing_source_size_stays_unknown_and_does_not_use_steam():
    result = annotate_download_sizes([{"id": 1, "downloadSource": "uri", "steam": {"storage": "100 GB"}}], [{"uri": "uri", "file_size": "Estándar"}])[0]
    assert result["download_size"] is None
    assert result["download_size_bytes"] is None
    assert size_bytes("1,5 GiB") == int(1.5 * 1024**3)
    assert size_bytes("10-20 GB") is None
