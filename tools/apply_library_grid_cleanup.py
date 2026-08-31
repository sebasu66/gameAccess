from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


tsx_path = Path("apps/desktop/src/LibraryRoom.tsx")
tsx = tsx_path.read_text(encoding="utf-8")

tsx = replace_once(
    tsx,
    '''function InstallStateBadge({ status }: { status?: SteamDownloadStatus }) {
  const installed = status?.state === "installed" || status?.installed === true;
  const active = Boolean(status && ["requested", "preparing", "downloading"].includes(status.state));
  if (installed) return <span className="library-install-state ready" title="Instalado · listo para jugar"><Play size={12} fill="currentColor" /></span>;
  if (active) return <span className="library-install-state progress" title={`Descargando${status?.progress != null ? ` · ${Math.round(status.progress)}%` : ""}`}><Loader2 size={12} className="spin" /></span>;
  return <span className="library-install-state download" title="En tu biblioteca · falta descargar"><Download size={12} /></span>;
}''',
    '''function InstallStateBadge({ status, available }: { status?: SteamDownloadStatus; available: boolean }) {
  const installed = status?.state === "installed" || status?.installed === true;
  if (!installed || !available) return null;
  return <span className="library-install-state ready" title="Instalado · listo para jugar"><Play size={12} fill="currentColor" /></span>;
}''',
    "install badge",
)

tsx = replace_once(
    tsx,
    '<header className="library-room-heading"><div><span className="eyebrow">BIBLIOTECA</span><h2>Elegí un juego</h2></div><small>0 juegos · WASD / FLECHAS</small></header>',
    '<header className="library-room-heading"><small>0 juegos · WASD / FLECHAS</small></header>',
    "empty heading",
)

tsx = replace_once(
    tsx,
    '<header className="library-room-heading"><div><span className="eyebrow">BIBLIOTECA</span><h2>Elegí un juego</h2></div><small>{games.length} juegos{accountCount ? ` · ${accountCount} cuenta${accountCount === 1 ? "" : "s"}` : ""} · WASD / FLECHAS</small></header>',
    '<header className="library-room-heading"><small>{games.length} juegos{accountCount ? ` · ${accountCount} cuenta${accountCount === 1 ? "" : "s"}` : ""} · WASD / FLECHAS</small></header>',
    "catalog heading",
)

tsx = replace_once(
    tsx,
    '<span className="library-room-card-art"><SteamCover game={game} /><InstallStateBadge status={game.app_id ? downloads[game.app_id] : undefined} /></span>\n              <strong>{game.name}</strong>',
    '<span className="library-room-card-art"><SteamCover game={game} /><InstallStateBadge status={game.app_id ? downloads[game.app_id] : undefined} available={game.copies_available > 0} /></span>',
    "card contents",
)

tsx_path.write_text(tsx, encoding="utf-8")

css_path = Path("apps/desktop/src/library-room.css")
css = css_path.read_text(encoding="utf-8")
css = replace_once(
    css,
    '''.library-room-heading { flex: 0 0 auto; display: flex; align-items: end; justify-content: space-between; gap: 18px; margin: 4px 2px 16px; }
.library-room-heading h2 { margin: 4px 0 0; font-size: clamp(28px,2.7vw,44px); letter-spacing: -.045em; }
.library-room-heading small { color: #788493; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.library-room-grid {
  min-height: 0; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(auto-fill, minmax(116px,1fr));
  align-content: start; gap: clamp(12px,1.2vw,18px); padding: 7px 12px 70px 7px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent;
}
.library-room-card { min-width: 0; padding: 0 0 6px; border: 0; border-radius: 13px; color: #b8c0ca; background: transparent; text-align: left; cursor: pointer; transition: transform .16s ease, color .16s ease; }
.library-room-card-art { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 2 / 3; overflow: hidden; border: 2px solid rgba(255,255,255,.08); border-radius: 10px; background: #111824; color: #8290a1; transition: border-color .17s ease, box-shadow .17s ease, filter .17s ease, transform .17s ease; }
.library-room-card-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.library-room-card > strong { display: block; overflow: hidden; padding: 9px 3px 0; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.library-room-card.is-selected { color: #fff; transform: translateY(-2px); }''',
    '''.library-room-heading { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; min-height: 14px; margin: 0 4px 8px; }
.library-room-heading small { color: #788493; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.library-room-grid {
  min-height: 0; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(auto-fill, minmax(132px,1fr));
  align-content: start; gap: clamp(14px,1.35vw,20px); padding: 6px 12px 70px 7px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent;
}
.library-room-card { min-width: 0; padding: 0; border: 0; border-radius: 14px; color: #b8c0ca; background: transparent; text-align: left; cursor: pointer; transition: transform .16s ease, color .16s ease; }
.library-room-card-art { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 2 / 3; overflow: hidden; border: 2px solid rgba(255,255,255,.08); border-radius: 12px; background: #111824; color: #8290a1; transition: border-color .17s ease, box-shadow .17s ease, filter .17s ease, transform .17s ease; }
.library-room-card-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.library-room-card.is-selected { color: #fff; transform: translateY(-2px); }''',
    "grid sizing",
)
css = replace_once(
    css,
    '.library-room-card.is-selected > strong { font-weight: 950; text-shadow: 0 0 16px rgba(57,255,20,.28); }\n',
    '',
    "selected title styling",
)
css = replace_once(
    css,
    '@media (max-width: 1050px) { .library-room { grid-template-columns: minmax(330px,38vw) minmax(0,1fr); gap: 16px; padding-inline: 16px; } .library-room-feature-copy { inset-inline: 24px; } .library-room-grid { grid-template-columns: repeat(auto-fill,minmax(104px,1fr)); } }',
    '@media (max-width: 1050px) { .library-room { grid-template-columns: minmax(330px,38vw) minmax(0,1fr); gap: 16px; padding-inline: 16px; } .library-room-feature-copy { inset-inline: 24px; } .library-room-grid { grid-template-columns: repeat(auto-fill,minmax(118px,1fr)); } }',
    "responsive card sizing",
)
css = replace_once(
    css,
    '''.library-install-state { position: absolute; z-index: 4; top: 7px; right: 7px; width: 25px; height: 25px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.32); border-radius: 50%; backdrop-filter: blur(10px); box-shadow: 0 5px 15px rgba(0,0,0,.42); }
.library-install-state.ready { color: #071405; background: rgba(57,255,20,.94); box-shadow: 0 0 16px rgba(57,255,20,.42), 0 5px 15px rgba(0,0,0,.42); }
.library-install-state.download { color: #241500; background: rgba(255,176,0,.96); box-shadow: 0 0 16px rgba(255,176,0,.35), 0 5px 15px rgba(0,0,0,.42); }
.library-install-state.progress { color: white; background: rgba(0,152,255,.9); box-shadow: 0 0 18px rgba(0,152,255,.4), 0 5px 15px rgba(0,0,0,.42); }''',
    '''.library-install-state { position: absolute; z-index: 4; top: 8px; right: 8px; width: 27px; height: 27px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.34); border-radius: 50%; backdrop-filter: blur(10px); box-shadow: 0 5px 15px rgba(0,0,0,.42); }
.library-install-state.ready { color: #071405; background: rgba(57,255,20,.94); box-shadow: 0 0 16px rgba(57,255,20,.42), 0 5px 15px rgba(0,0,0,.42); }''',
    "badge styles",
)
css_path.write_text(css, encoding="utf-8")
