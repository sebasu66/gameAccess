from __future__ import annotations

import argparse
import json
import os
import py_compile
import subprocess
import sys
import time
from pathlib import Path

from transfer_core import RemoteFile, VikingFileHost

ROOT = Path(__file__).resolve().parent
PUBLIC_SMOKE_SOURCE = (
    "https://raw.githubusercontent.com/sebasu66/gameAccess/"
    "prototype/torrent-cloud-transfer/tools/torrent-transfer-prototype/README.md"
)


def run_unit_tests() -> None:
    subprocess.run(
        [sys.executable, "-m", "unittest", "-v", "test_transfer_core.py"],
        cwd=ROOT,
        check=True,
    )


def compile_sources() -> None:
    py_compile.compile(str(ROOT / "transfer_core.py"), doraise=True)
    py_compile.compile(str(ROOT / "app.py"), doraise=True)


def smoke_viking() -> dict[str, str]:
    remote = RemoteFile(
        filename="gameaccess-torrent-prototype-readme.md",
        size=None,
        url=PUBLIC_SMOKE_SOURCE,
    )
    hosted = VikingFileHost().remote_upload(remote)
    return {
        "status": "ok",
        "provider": hosted.provider,
        "url": hosted.url,
        "source": PUBLIC_SMOKE_SOURCE,
    }


def launch_ui() -> int:
    kwargs: dict[str, object] = {
        "cwd": str(ROOT),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name == "nt":
        flags = 0
        flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        flags |= getattr(subprocess, "DETACHED_PROCESS", 0)
        kwargs["creationflags"] = flags

    process = subprocess.Popen([sys.executable, str(ROOT / "app.py")], **kwargs)
    time.sleep(1.5)
    exit_code = process.poll()
    if exit_code is not None:
        raise RuntimeError(f"Prototype UI exited immediately with code {exit_code}.")
    return process.pid


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify and optionally launch the torrent transfer prototype.")
    parser.add_argument("--smoke-viking", action="store_true", help="Perform a small live server-to-server URL import using the public README.")
    parser.add_argument("--launch-ui", action="store_true", help="Launch app.py as a detached visible desktop GUI.")
    args = parser.parse_args()

    report: dict[str, object] = {
        "compile": "pending",
        "unit_tests": "pending",
        "viking_smoke": {"status": "not_requested"},
        "ui": {"status": "not_requested"},
    }

    compile_sources()
    report["compile"] = "ok"

    run_unit_tests()
    report["unit_tests"] = "ok"

    if args.smoke_viking:
        try:
            report["viking_smoke"] = smoke_viking()
        except Exception as exc:  # smoke failure should not prevent local UI verification
            report["viking_smoke"] = {
                "status": "failed",
                "error": f"{type(exc).__name__}: {exc}",
            }

    if args.launch_ui:
        pid = launch_ui()
        report["ui"] = {"status": "running", "pid": pid}

    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
