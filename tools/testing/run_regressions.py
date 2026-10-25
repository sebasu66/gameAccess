"""Named regression batches for development and major module changes.

Uses synthetic databases and temporary game folders; never real game downloads.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / "apps/desktop"
API = ROOT / "apps/api"
LAUNCHER = ROOT / "apps/launcher"

BATCHES = {
    "catalog": [
        ("api", ["test_library_catalog.py", "test_detail_cache_recovery.py", "test_catalog_locale.py", "test_discovery_service.py", "test_packaged_discovery.py"]),
        ("desktop", ["src/librarySearch.test.ts", "src/libraryMembership.test.ts", "src/catalog/digitalCatalog.test.ts", "src/catalog/digitalCatalogDetails.test.ts", "src/catalogUpdates.test.ts", "src/regressionScale.test.tsx"]),
    ],
    "downloads": [
        ("launcher", ["test_digital_http_files.py", "test_digital_torrent_transfer.py", "test_digital_download_controls.py", "test_digital_cleanup.py", "test_digital_status_persistence.py", "test_flow_diagnostics.py"]),
        ("desktop", ["src/catalog/pluginSources.test.ts", "src/catalog/pluginRuntime.test.ts", "src/catalog/digitalDownloadQueue.test.ts", "src/catalog/digitalDownloadService.test.ts", "src/downloadManager.test.ts", "src/FlowDiagnostics.test.ts"]),
    ],
    "installation": [("launcher", ["test_digital_extraction.py", "test_digital_backup.py", "test_digital_storage.py", "test_execution_profile.py"])],
    "execution": [
        ("launcher", ["test_play_process_smoke.py", "test_digital_options.py", "test_game_shortcut.py", "test_execution_profile.py"]),
        ("desktop", ["src/catalog/digitalProcessManager.test.ts", "src/libraryMembership.test.ts", "src/LibraryActionMatrix.test.tsx"]),
    ],
    "diagnostics": [("launcher", ["test_flow_diagnostics.py"]), ("api", ["test_request_diagnostics.py"]), ("desktop", ["src/FlowDiagnostics.test.ts"])],
    "full": [("api", []), ("launcher", []), ("desktop", []), ("build", []), ("native", [])],
}


def executable(name, explicit=None):
    value = explicit or shutil.which(name)
    if not value:
        raise RuntimeError(f"Required runtime '{name}' is missing; use --{name}.")
    return str(value)


def python_for(directory):
    relative = "Scripts/python.exe" if os.name == "nt" else "bin/python"
    local = directory / ".venv" / relative
    return str(local) if local.is_file() else sys.executable


def command(lane, files, args):
    if lane in ("api", "launcher"):
        directory = API if lane == "api" else LAUNCHER
        return directory, [python_for(directory), "-X", "utf8", "-m", "pytest", "-q", "--tb=short", *([f"tests/{file}" for file in files] or ["tests"])]
    node = executable("node", args.node)
    if lane == "desktop":
        return DESKTOP, [node, "node_modules/vitest/vitest.mjs", "run", "--reporter=dot", *files]
    if lane == "build":
        return DESKTOP, [node, "node_modules/typescript/bin/tsc"]
    # The build lane below also produces the Tauri frontend assets.
    rustup = executable("rustup", args.rustup)
    return ROOT, [rustup, "run", "stable", "cargo", "test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--release", "--locked", "--quiet"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", choices=BATCHES, default="full")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--node")
    parser.add_argument("--rustup")
    parser.add_argument("--report-dir", type=Path, default=ROOT / ".cache/regressions")
    args = parser.parse_args()
    if args.list:
        print(json.dumps(BATCHES, indent=2))
        return 0
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.report_dir / f"{stamp}-{args.batch}"
    output.mkdir(parents=True, exist_ok=True)
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.splitlines()
    report = {"batch": args.batch, "commit": commit, "dirty": dirty, "started": stamp, "lanes": []}
    environment = dict(os.environ, PYTHON_DOTENV_DISABLED="1", GAMEACCESS_DATABASE_URL="sqlite://", GAMEACCESS_ALLOW_SQLITE_FOR_TESTS="1", GAMEACCESS_DISCOVERY_SYNC="0")
    try:
        for lane, files in BATCHES[args.batch]:
            cwd, argv = command(lane, files, args)
            started = time.monotonic()
            print(f"Running {lane} ({len(files) if files else 'all'} test files)...", flush=True)
            with (output / f"{lane}.log").open("w", encoding="utf-8") as log:
                result = subprocess.run(argv, cwd=cwd, env=environment, stdout=log, stderr=subprocess.STDOUT)
                code = result.returncode
                if lane == "build" and code == 0:
                    code = subprocess.run([argv[0], "node_modules/vite/bin/vite.js", "build"], cwd=cwd, env=environment, stdout=log, stderr=subprocess.STDOUT).returncode
            entry = {"lane": lane, "exit_code": code, "seconds": round(time.monotonic() - started, 2), "files": files}
            report["lanes"].append(entry)
            print(f"{lane}: {'PASS' if code == 0 else 'FAIL'} ({entry['seconds']}s)", flush=True)
    except (OSError, RuntimeError) as error:
        report["error"] = str(error)
        print(error, file=sys.stderr)
    finally:
        report["ok"] = "error" not in report and len(report["lanes"]) == len(BATCHES[args.batch]) and all(entry["exit_code"] == 0 for entry in report["lanes"])
        (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Report: {output / 'report.json'}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
