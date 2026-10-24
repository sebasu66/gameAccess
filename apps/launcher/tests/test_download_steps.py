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
    steps.follow("preparing", "Torbox está bajando el juego: 46 %")
    assert steps.payload()["step"]["detail"] == "Torbox está bajando el juego: 46 %"
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
