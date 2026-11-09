# On-demand lifecycle tests (tests/test_lifecycle.py): a game's whole life on a copy of the launcher with its own
# games folder: download, unpack, set up, "-ready", library, verification, freeze, thaw, deep freeze, thaw, uninstall.
# Nothing of this PC's library is touched. The app's own cycle with a real game is tools/gameaccess-mcp (npm run regress -- --cycle).
#   .\run_lifecycle_tests.ps1
$ErrorActionPreference = 'Stop'
$env:GAMEACCESS_LIFECYCLE = '1'
try {
    & (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') -m pytest (Join-Path $PSScriptRoot 'tests\test_lifecycle.py') (Join-Path $PSScriptRoot 'tests\test_ready_rename.py') -v
    exit $LASTEXITCODE
} finally {
    Remove-Item Env:GAMEACCESS_LIFECYCLE -ErrorAction SilentlyContinue
}
