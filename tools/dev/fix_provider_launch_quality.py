from pathlib import Path

root = Path(__file__).resolve().parents[2]
app = root / "apps" / "desktop" / "src" / "App.tsx"
test = root / "apps" / "desktop" / "src" / "providerLaunch.test.ts"

app_source = app.read_text(encoding="utf-8")
old_app = '  const featuredPlayReady = Boolean(featured?.app_id && gameStateManager.isPlayButtonReady(downloads[featured.app_id]));\n'
new_app = '  const featuredPlayReady = gameStateManager.isPlayButtonReady(downloads[Number(featured?.app_id)]);\n'
if app_source.count(old_app) != 1:
    raise RuntimeError(f"Expected one featured Play expression, found {app_source.count(old_app)}")
app.write_text(app_source.replace(old_app, new_app, 1), encoding="utf-8")

test_source = test.read_text(encoding="utf-8")
old_test = '    expect(appSource).toContain("gameStateManager.isPlayButtonReady(downloads[featured.app_id])");\n'
new_test = '    expect(appSource).toContain("gameStateManager.isPlayButtonReady(downloads[Number(featured?.app_id)])");\n'
if test_source.count(old_test) != 1:
    raise RuntimeError(f"Expected one provider Play assertion, found {test_source.count(old_test)}")
test.write_text(test_source.replace(old_test, new_test, 1), encoding="utf-8")
