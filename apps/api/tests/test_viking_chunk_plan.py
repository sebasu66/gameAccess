from app.viking_chunk_plan import DEFAULT_TIERS, MB, MIN_PIECE, QUICK_PIECES, PlannedPiece, piece_size_at, plan_pieces

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


def test_first_five_pieces_are_100_mb_and_then_they_grow_to_1_gb():
    pieces = plan_pieces([20 * GB])
    sizes = [p.size for p in pieces]
    assert sizes[:QUICK_PIECES] == [100 * MB] * 5
    assert sizes[QUICK_PIECES] == 500 * MB
    assert max(sizes) <= 1 * GB * 1.25
    assert sizes[-2] >= 1 * GB or sizes[-1] >= 1 * GB
    # Sizes never shrink from one piece to the next (ignoring the folded tail of the file).
    assert sizes[:-1] == sorted(sizes[:-1])


def test_after_the_quick_pieces_a_piece_is_a_tenth_of_the_game_but_never_under_100_mb():
    assert [p.size for p in plan_pieces([2 * GB])][QUICK_PIECES] == 2 * GB // 10
    small = plan_pieces([405_850_134])  # Enter the Gungeon: one 400 MB file now streams in 4 pieces
    assert [p.size for p in small][:3] == [MIN_PIECE] * 3 and len(small) == 4
    assert min(p.size for p in plan_pieces([800 * MB])) >= MIN_PIECE // 4  # only a folded tail can be smaller


def test_a_ten_gb_game_needs_far_fewer_uploads_than_flat_100_mb_pieces():
    pieces = plan_pieces([10 * GB])
    assert len(pieces) <= 16  # 5 quick pieces of 100 MB, then 500 MB and 1 GB
    assert len(pieces) < (10 * GB) // (100 * MB) / 5


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
    assert piece_size_at(0, total, index=0) == MIN_PIECE
    assert piece_size_at(0, total) == 500 * MB
    assert piece_size_at(int(total * 0.15), total) == 1 * GB
    assert piece_size_at(int(total * 0.90), total) == 1 * GB
    assert DEFAULT_TIERS[-1][0] == 1.0
