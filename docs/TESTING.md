# Regression batches

Use a focused batch during development. Run `full` after a large refactor, a change
to IPC/contracts, deployment preparation or a change spanning multiple modules.
Small changes do not require the complete batch every time.

```powershell
python tools/testing/run_regressions.py --list
python tools/testing/run_regressions.py --batch catalog
python tools/testing/run_regressions.py --batch downloads
python tools/testing/run_regressions.py --batch installation
python tools/testing/run_regressions.py --batch execution
python tools/testing/run_regressions.py --batch diagnostics
python tools/testing/run_regressions.py --batch full
```

The runner uses each Python virtual environment when present and Node/Rustup from
PATH. `--node PATH` and `--rustup PATH` select explicit runtimes. Reports and each
lane's full output are saved under `.cache/regressions/<timestamp>-<batch>`.
The JSON report records HEAD, dirty paths, exit codes and elapsed times. It fails
if a required runtime is missing or a lane fails; inspect test summaries for skips.

| Batch | Critical contracts |
| --- | --- |
| `catalog` | API record identity, library contents, locale/cache recovery, discovery packages, local search and catalog scale |
| `downloads` | HTTP file validation, real local torrent peer, pause/resume/cancel, status durability, plugin revisions and BASE/PLUS scheduling |
| `installation` | Archive extraction/order, retained backup, portable installation, partial-install uninstall and isolated sibling folders |
| `execution` | Executable options, local profiles, Windows real-process fixture, uninstall isolation, shortcuts and library membership |
| `diagnostics` | Success discard, full failure flush, concurrent isolation, cancellation and credential redaction |
| `full` | Complete API, launcher and React suites, frontend build and native tests |

API tests force isolated SQLite and disable dotenv/background synchronization.
Launcher tests use generated files and temporary folders. Torrent and HTTP tests
use loopback fixtures, not public providers. The real Play fixture invokes a
harmless batch file through the existing runner and checks its output. It does
not run an installed game or bypass UAC. Native IPC tests exercise actual worker
pause/resume/cancel. Keep tests sequential at lane level to avoid fixture races.

Automated success is not visual acceptance, a commercial-game installation test,
UAC validation, or proof of Render deployment. Native tests marked ignored require
their specific runtime environment. Report their omission separately. For a
release, also inspect installer payloads and perform the requested native UI test.

See [module ownership](MODULE_MAP.md) before changing a flow. In particular,
diagnostic buffers are transaction-owned and have **no size limit**; they are not
historical logs. Test that successful detail never reaches a file and that an
error contains every preceding diagnostic event.
