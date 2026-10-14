from app.viking_chunk_plan import DEFAULT_TIERS, MB, PlannedPiece, piece_size_at, plan_pieces

GB = 1024 * MB


def test_pieces_cover_every_byte_once_and_never_cross_files():
    sizes = [9_720_085_790, 350 * MB, 1]
    pieces = plan_pieces(sizes)
    for file_index, size in enumerate(sizes):
        mine = [p for p in pieces if p.file_index == file_index]
        assert mine[0].start == 0
        assert mine[-1].end == size - 1
        for before, after in zip(mine, mine[1:]):
            assert after.start == before.end + 1
    assert [p.index for p in pieces] == list(range(len(pieces)))


def test_first_pieces_are_100_mb_and_they_grow_up_to_600_mb():
    pieces = plan_pieces([20 * GB])
    sizes = [p.size for p in pieces]
    assert sizes[0] == 100 * MB
    assert max(sizes) <= 600 * MB * 1.25
    assert sizes[-2] >= 600 * MB or sizes[-1] >= 600 * MB
    # Sizes never shrink from one tier to the next (ignoring the folded tail of the file).
    tier_sizes = [piece_size_at(sum(s for s in sizes[:i]), 20 * GB) for i in range(len(sizes))]
    assert tier_sizes == sorted(tier_sizes)


def test_a_ten_gb_game_needs_far_fewer_uploads_than_flat_100_mb_pieces():
    pieces = plan_pieces([10 * GB])
    assert len(pieces) < 40
    assert len(pieces) < (10 * GB) // (100 * MB) / 2


def test_small_files_are_one_piece_and_empty_files_are_skipped():
    assert plan_pieces([50 * MB]) == [PlannedPiece(0, 0, 0, 50 * MB - 1)]
    assert plan_pieces([0, 80 * MB]) == [PlannedPiece(0, 1, 0, 80 * MB - 1)]
    assert plan_pieces([]) == []
    assert plan_pieces([0]) == []


def test_a_small_leftover_is_folded_into_the_last_piece():
    pieces = plan_pieces([100 * MB + 10 * MB])
    assert len(pieces) == 1 and pieces[0].size == 110 * MB
    pieces = plan_pieces([100 * MB + 40 * MB])
    assert [p.size for p in pieces] == [100 * MB, 40 * MB]


def test_tiers_follow_the_share_of_the_whole_download():
    total = 10 * GB
    assert piece_size_at(0, total) == 100 * MB
    assert piece_size_at(int(total * 0.15), total) == 250 * MB
    assert piece_size_at(int(total * 0.45), total) == 400 * MB
    assert piece_size_at(int(total * 0.90), total) == 600 * MB
    assert DEFAULT_TIERS[-1][0] == 1.0
