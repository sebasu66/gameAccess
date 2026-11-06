"""Splits a TorBox download into pieces that grow as the transfer advances.

The first pieces are 100 MB so the player can start almost at once (it streams: every piece is handed
out as soon as it reaches ViKiNG). After them a piece is a tenth of the whole download, never under
100 MB and never over its tier (500 MB for the first tenth, then 1 GB): fewer files, uploads and
requests are cheaper once the download is under way.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

MB = 1024 * 1024

# (share of the whole download that this tier runs up to, largest piece size in bytes)
DEFAULT_TIERS: tuple[tuple[float, int], ...] = (
    (0.10, 500 * MB),
    (1.00, 1024 * MB),
)
MIN_PIECE = 100 * MB      # no piece is planned smaller (a file smaller than this is one piece)
QUICK_PIECES = 5          # the first pieces are MIN_PIECE so the player starts soon
SHARE_DIVISOR = 10        # after them a piece is about a tenth of the whole download


@dataclass(frozen=True)
class PlannedPiece:
    index: int        # position in the whole job, starting at 0
    file_index: int   # which file of the torrent the bytes belong to
    start: int        # first byte inside that file
    end: int          # last byte inside that file (inclusive, like an HTTP Range)

    @property
    def size(self) -> int:
        return self.end - self.start + 1


def piece_size_at(offset: int, total: int, tiers: Sequence[tuple[float, int]] = DEFAULT_TIERS, index: int = QUICK_PIECES) -> int:
    """Piece size for piece number `index` that starts `offset` bytes into a download of `total` bytes."""
    if index < QUICK_PIECES:
        return MIN_PIECE
    share = offset / total if total > 0 else 1.0
    cap = next((size for limit, size in tiers if share < limit), tiers[-1][1])
    return max(MIN_PIECE, min(cap, total // SHARE_DIVISOR))


def plan_pieces(file_sizes: Sequence[int], tiers: Sequence[tuple[float, int]] = DEFAULT_TIERS) -> list[PlannedPiece]:
    """Plan the pieces of every file, in order.

    A piece never crosses from one file into the next. A leftover smaller than a quarter of the
    piece size is folded into the last piece of the file instead of becoming a tiny upload, so a
    piece can be up to a quarter larger than its tier size.
    """
    total = sum(max(0, int(size)) for size in file_sizes)
    pieces: list[PlannedPiece] = []
    if total <= 0:
        return pieces
    done = 0
    for file_index, raw_size in enumerate(file_sizes):
        file_size = max(0, int(raw_size))
        position = 0
        while position < file_size:
            step = piece_size_at(done + position, total, tiers, len(pieces))
            length = min(step, file_size - position)
            if 0 < file_size - position - length < step // 4:
                length = file_size - position
            pieces.append(PlannedPiece(len(pieces), file_index, position, position + length - 1))
            position += length
        done += file_size
    return pieces
