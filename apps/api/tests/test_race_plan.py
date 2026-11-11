from app.race_plan import RaceCandidate, plan_race

A, B, C = "a" * 40, "b" * 40, "c" * 40


def candidates(*hashes):
    return [RaceCandidate(index=index, hash=value) for index, value in enumerate(hashes)]


def test_the_best_seeded_race_and_the_plan_sets_how_many(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_RACE_TIERS", raising=False)
    scrape = lambda tracker, hashes: {A: 3, B: 40, C: 0}
    plus = plan_race("plus", candidates(A, B, C, None), scrape)
    assert [r["index"] for r in plus["racers"]] == [1, 0, 3]  # unknown seeds before none at all
    assert plus["decideAfter"] == 60
    assert [r["index"] for r in plan_race("base", candidates(A, B, C), scrape)["racers"]] == [1, 0]


def test_each_tracker_is_asked_and_the_most_seeds_count(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_RACE_TIERS", raising=False)
    asked = []
    def scrape(tracker, hashes):
        asked.append(tracker)
        return {A: 5} if "opentrackr" in tracker else {A: 1, B: 9}
    racers = plan_race("plus", candidates(A, B), scrape)["racers"]
    assert len(asked) == 4
    assert racers == [{"index": 1, "seeds": 9}, {"index": 0, "seeds": 5}]


def test_a_plan_can_be_left_without_a_race_by_settings(monkeypatch):
    monkeypatch.setenv("GAMEACCESS_RACE_TIERS", '{"base": {"racers": 1}, "plus": {"racers": 3}}')
    assert plan_race("base", candidates(A, B), lambda *_: {}) == {"racers": []}
    assert len(plan_race("plus", candidates(A, B), lambda *_: {})["racers"]) == 2


def test_one_candidate_is_no_race():
    assert plan_race("plus", candidates(A), lambda *_: {}) == {"racers": []}
