$ErrorActionPreference = 'Stop'

git fetch origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git merge --ff-only origin/main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Push-Location apps/launcher
$py = '.\.venv\Scripts\python.exe'
& $py -m pytest tests -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $py -m compileall -q .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Pop-Location

git diff --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git rm tools/dev/apply_provider_ownership_refactor_022.py tools/dev/fix_provider_ownership_tests_026.py tools/dev/publish_provider_ownership_027.ps1
git add apps/launcher/family_refresh.py apps/launcher/pool_sync.py apps/launcher/provider_account_onboard.py apps/launcher/provider_incremental_sync.py apps/launcher/tests/test_provider_account_onboard.py apps/launcher/tests/test_provider_ownership_store.py
git commit -m 'fix(pool): make provider ownership authoritative per account'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git push origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git rev-parse HEAD
git status --short --branch
