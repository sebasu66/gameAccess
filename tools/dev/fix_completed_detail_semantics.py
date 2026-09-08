from pathlib import Path

path = Path(__file__).resolve().parents[2] / "apps" / "desktop" / "src" / "LibraryDetailPanel.tsx"
text = path.read_text(encoding="utf-8")
text = text.replace(' role="group" aria-label={`Preferencia para ${props.game.name}`}', "")
text = text.replace(' role="group" aria-label="Descarga activa"', "")
text = text.replace(' role="region" aria-label="Detalles extendidos del juego"', "")
path.write_text(text, encoding="utf-8")
print("Detail semantic normalization applied.")
