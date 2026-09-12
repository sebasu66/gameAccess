from pathlib import Path

app = Path(__file__).resolve().parents[2] / "apps" / "desktop" / "src" / "App.tsx"
source = app.read_text(encoding="utf-8")
old = '  const featuredPlayReady = Boolean(featured?.app_id && gameStateManager.isPlayButtonReady(downloads[featured.app_id]));\n'
new = '  const featuredPlayReady = gameStateManager.isPlayButtonReady(downloads[Number(featured?.app_id)]);\n'
if source.count(old) != 1:
    raise RuntimeError(f"Expected one featured Play expression, found {source.count(old)}")
app.write_text(source.replace(old, new, 1), encoding="utf-8")
