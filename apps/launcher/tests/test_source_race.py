import unittest

from game_download_manager.source_race import Lane, RacePlan, magnet_info_hash, race_winner

HEX = "c12fe1c06bba254a9dc9f519b335aa7c1367a88a"


def plan(**kwargs):
    base = {"racers": [{"source": "magnet:?xt=urn:btih:" + HEX}, {"source": "magnet:?xt=urn:btih:" + "a" * 40}, {"source": "magnet:?xt=urn:btih:" + "b" * 40}]}
    return RacePlan.from_dict({**base, **kwargs})


class MagnetHashTest(unittest.TestCase):
    def test_hex_and_base32(self):
        self.assertEqual(magnet_info_hash(f"magnet:?xt=urn:btih:{HEX.upper()}&dn=x"), HEX)
        self.assertEqual(magnet_info_hash("magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK"), HEX)

    def test_not_a_magnet(self):
        self.assertIsNone(magnet_info_hash("https://example.org/game.torrent"))
        self.assertIsNone(magnet_info_hash("magnet:?dn=nothing"))


class RacePlanTest(unittest.TestCase):
    def test_needs_two_racers(self):
        self.assertIsNone(RacePlan.from_dict({"racers": [{"source": "magnet:?xt=urn:btih:" + HEX}]}))
        self.assertIsNone(RacePlan.from_dict(None))

    def test_reads_the_server_numbers(self):
        read = plan(decideAfter=30, giveUpAfter=20, lead=2)
        self.assertEqual((read.decide_after, read.give_up_after, read.lead), (30, 30, 2))


class RaceWinnerTest(unittest.TestCase):
    def test_waits_before_the_minute(self):
        self.assertIsNone(race_winner(plan(), 30, [Lane(done=900, metadata=True), Lane(done=10, metadata=True), Lane(metadata=True)]))

    def test_a_clear_leader_wins_at_the_minute(self):
        self.assertEqual(race_winner(plan(), 60, [Lane(done=100, metadata=True), Lane(done=300, metadata=True), Lane(done=50, metadata=True)]), 1)

    def test_a_close_race_goes_on_until_the_end(self):
        lanes = [Lane(done=100, metadata=True), Lane(done=110, metadata=True), Lane(metadata=True)]
        self.assertIsNone(race_winner(plan(), 60, lanes))
        self.assertEqual(race_winner(plan(), 120, lanes), 1)

    def test_a_finished_racer_wins_at_once(self):
        self.assertEqual(race_winner(plan(), 5, [Lane(done=10), Lane(done=5, finished=True), Lane()]), 1)

    def test_the_last_one_standing_wins(self):
        self.assertEqual(race_winner(plan(), 10, [Lane(dropped=True), Lane(metadata=True), Lane(dropped=True)]), 1)

    def test_nothing_downloaded_goes_to_the_best_seeded_at_the_end(self):
        lanes = [Lane(seeds=2, metadata=True), Lane(seeds=9, metadata=True), Lane(metadata=True)]
        self.assertIsNone(race_winner(plan(), 90, lanes))
        self.assertEqual(race_winner(plan(), 120, lanes), 1)


if __name__ == "__main__":
    unittest.main()
