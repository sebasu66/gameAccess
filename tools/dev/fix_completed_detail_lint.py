from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps" / "desktop" / "src"

panel_path = SRC / "LibraryDetailPanel.tsx"
panel = panel_path.read_text(encoding="utf-8")
panel = panel.replace(
    'function SteamRichText({ html }: { html: string }) {\n  return <div className="steam-rich-text" dangerouslySetInnerHTML={{ __html: sanitizeSteamRichHtml(html) }} />;\n}',
    'function SteamRichText({ html }: { html: string }) {\n  // biome-ignore lint/security/noDangerouslySetInnerHtml: content is reduced to an allowlist and safe HTTPS attributes above.\n  return <div className="steam-rich-text" dangerouslySetInnerHTML={{ __html: sanitizeSteamRichHtml(html) }} />;\n}',
)
panel = panel.replace(
    '<div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>',
    '<div className="library-room-preferences" role="group" aria-label={`Preferencia para ${props.game.name}`}>',
)
panel = panel.replace('  const imagesKey = images.join("|");\n\n', '')
panel = panel.replace(
    '  }, [game.id, videoSrc, imagesKey, reducedMotion]);',
    '  }, [videoSrc, images, reducedMotion]);',
)
panel = panel.replace(
    '    const timer = window.setTimeout(() => setState((current) => afterDetailImage(current)), SCREENSHOT_HOLD_MS);\n    return () => window.clearTimeout(timer);\n  }, [paused, reducedMotion, state.phase, state.imageIndex, state.images.length]);',
    '    const timer = window.setInterval(() => setState((current) => afterDetailImage(current)), SCREENSHOT_HOLD_MS);\n    return () => window.clearInterval(timer);\n  }, [paused, reducedMotion, state.phase, state.images.length]);',
)
panel = panel.replace(
    '<div className="library-room-active-download" aria-label="Descarga activa">',
    '<div className="library-room-active-download" role="group" aria-label="Descarga activa">',
)
panel = panel.replace(
    '<div className="library-detail-extended" tabIndex={0} aria-label="Detalles extendidos del juego">',
    '<div className="library-detail-extended" role="region" aria-label="Detalles extendidos del juego">',
)
panel_path.write_text(panel, encoding="utf-8")

catalog_path = SRC / "DownloadCatalogPanel.tsx"
catalog = catalog_path.read_text(encoding="utf-8")
catalog = catalog.replace(
    '  }, [props.games.length, props.gridRef, props.selectedIndex]);',
    '  }, [props.gridRef, props.selectedIndex]);',
)
catalog_path.write_text(catalog, encoding="utf-8")

print("Completed detail lint normalization applied.")
