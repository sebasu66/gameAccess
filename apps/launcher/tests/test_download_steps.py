import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from game_download_manager.steps import StepTracker


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_accelerated_download_reports_each_step_with_result_and_duration():
    clock = Clock()
    steps = StepTracker(clock)
    steps.start("route", "Buscando si el servidor ya tiene el juego")
    clock.t += 1.5
    steps.finish("El servidor todavía no lo tiene")
    steps.start("probe", "Midiendo el torrent")
    steps.follow("downloading", "Descargando Juego (3.0%)")
    assert steps.payload()["step"]["id"] == "probe"
    clock.t += 20
    steps.finish("Lento (0.4 MB/s): se acelera por el servidor")
    steps.start("server", "Pidiéndole al servidor la descarga acelerada")
    steps.follow("preparing", "El servicio de aceleración está bajando el juego: 46 %")
    assert steps.payload()["step"]["detail"] == "El servicio de aceleración está bajando el juego: 46 %"
    clock.t += 60
    steps.follow("downloading", "Descargando pieza 1 de 50")
    payload = steps.payload()
    assert payload["step"]["id"] == "download"
    assert [(s["id"], s["state"]) for s in payload["steps"]] == [("route", "done"), ("probe", "done"), ("server", "done")]
    assert payload["steps"][0] == {"id": "route", "state": "done", "result": "El servidor todavía no lo tiene", "ms": 1500}
    assert payload["steps"][2]["ms"] == 60000


def test_direct_download_marks_the_decision_steps_as_not_needed():
    steps = StepTracker(Clock())
    steps.follow("preparing", "Preparando instalación y verificando espacio en disco...")
    assert steps.payload()["step"] is None
    steps.follow("downloading", "Descargando Juego")
    steps.follow("decompressing", "Descomprimiendo parte 1 de 2")
    steps.follow("completed", "¡Juego listo para jugar!")
    states = {s["id"]: s["state"] for s in steps.payload()["steps"]}
    assert states == {"route": "skipped", "probe": "skipped", "server": "skipped", "download": "done", "extract": "done", "install": "skipped"}
    assert steps.payload()["step"] is None


def test_a_failure_closes_the_current_step_with_the_error():
    steps = StepTracker(Clock())
    steps.follow("downloading", "Descargando Juego")
    steps.fail("Sin conexión")
    assert steps.payload()["steps"][-1]["state"] == "failed"
    assert steps.payload()["steps"][-1]["result"] == "Sin conexión"


def test_each_step_keeps_what_it_worked_with():
    clock = Clock()
    steps = StepTracker(clock)
    # Known before the step starts (where the download goes), it waits for it.
    steps.facts({"folder": "E:/Temp/game", "drive": "E:"}, "download")
    steps.start("download")
    steps.facts({"freeBytes": 10, "neededBytes": 5, "empty": ""}, "download")
    assert steps.payload()["step"]["facts"] == {"folder": "E:/Temp/game", "drive": "E:", "freeBytes": 10, "neededBytes": 5}
    steps.start("extract", "checking room")
    steps.facts({"folder": "D:/Games/game", "drive": "D:", "freeBytes": 1, "neededBytes": 9})
    steps.fail("no room")
    done = {step["id"]: step for step in steps.payload()["steps"]}
    assert done["download"]["facts"]["drive"] == "E:"
    assert done["extract"]["state"] == "failed" and done["extract"]["facts"]["folder"] == "D:/Games/game"


def test_a_free_steam_game_through_depotdownloader_has_only_its_own_steps():
    clock = Clock()
    steps = StepTracker(clock)
    steps.steam("depot")
    steps.start("signin")
    steps.facts({"account": "player"})
    steps.finish("Signed in")
    steps.follow("downloading", "file.dll")
    steps.start("handoff")
    steps.follow("installing", "handing over")       # no unpacking step appears
    assert steps.payload()["step"]["id"] == "handoff"
    steps.start("adopt")
    steps.follow("completed")
    assert [step["id"] for step in steps.payload()["steps"]] == ["signin", "download", "handoff", "adopt"]


def test_a_free_steam_game_that_steam_installs_has_its_window_then_the_download():
    steps = StepTracker(Clock())
    steps.steam()
    steps.start("dialog")
    steps.finish("Steam started the install")
    steps.start("download")
    steps.follow("downloading", "Steam is downloading it")
    steps.follow("completed")
    assert [step["id"] for step in steps.payload()["steps"]] == ["dialog", "download"]
