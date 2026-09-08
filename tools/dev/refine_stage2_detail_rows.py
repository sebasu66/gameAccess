from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PARTS = ROOT / "apps" / "desktop" / "src" / "LibraryRoomParts.tsx"
ROOM = ROOT / "apps" / "desktop" / "src" / "LibraryRoom.tsx"
CSS = ROOT / "apps" / "desktop" / "src" / "library-room.css"
DOC = ROOT / "docs" / "STAGE2_FIXES_2026-09-08.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: expected source not found")
    return text.replace(old, new, 1)


parts = PARTS.read_text(encoding="utf-8")

plain_anchor = 'function plainText(value?: string | null) { return (value ?? "").replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim(); }\n'
rich_helpers = plain_anchor + r'''

function sanitizeSteamRichHtml(value?: string | null) {
  if (!value) return "";
  if (typeof DOMParser === "undefined") return plainText(value);
  const document = new DOMParser().parseFromString(value, "text/html");
  const allowed = new Set(["P", "DIV", "BR", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "H1", "H2", "H3", "H4", "A", "IMG"]);
  for (const node of Array.from(document.body.querySelectorAll("*"))) {
    if (!allowed.has(node.tagName)) {
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      }
      continue;
    }
    for (const attribute of Array.from(node.attributes)) node.removeAttribute(attribute.name);
    if (node.tagName === "A") {
      const original = value.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
      if (original) {
        node.setAttribute("href", original);
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noreferrer");
      }
    }
  }
  return document.body.innerHTML;
}

function SteamRichText({ html }: { html: string }) {
  return <div className="steam-rich-text" dangerouslySetInnerHTML={{ __html: sanitizeSteamRichHtml(html) }} />;
}
'''
parts = replace_once(parts, plain_anchor, rich_helpers, "Steam rich text helper")

parts = replace_once(
    parts,
    '  const about = plainText(steam?.about_the_game);',
    '  const about = steam?.about_the_game ?? "";',
    "preserve Steam about formatting",
)

old_panel = '''  return (\n    <aside className="library-room-feature">\n      <MediaPanel {...props} />\n      <div className="library-room-feature-copy">\n        <header className="library-room-overview">\n          <span className="eyebrow">{props.showcaseMode ? "MODO VITRINA" : "TU BIBLIOTECA"}</span>\n          <h1>{props.game.name}</h1>\n          <p className="library-room-lead">{props.summary}</p>\n          {props.loadingDetails ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando ficha de Steam…</span> : null}\n        </header>\n\n        <div className="library-room-control-row">\n          <div className="library-room-actions glass-actions-row">\n            {props.actions.map((action, index) => (\n              <button type="button" key={`${action.kind}-${action.label}`} ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} data-action={action.kind} title={action.reason ?? undefined} className={`glass-action ${action.kind === "play" ? "play" : action.kind === "cancel" ? "cancel" : "download"} ${props.focusZone === "actions" && props.actionIndex === index ? "is-selected" : ""}`} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} onClick={() => props.onAction(index)} disabled={action.disabled}>\n                <span className="glass-action-icon">{action.icon}</span><span className="glass-action-label">{action.label}</span>\n              </button>\n            ))}\n          </div>\n          <div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>\n            <span>¿Te gusta?</span>\n            <button type="button" className={props.preference === 1 ? "selected" : ""} onClick={() => props.onPreference(1)} aria-label="Me gusta"><ThumbsUp size={15} /></button>\n            <button type="button" className={props.preference === -1 ? "selected negative" : ""} onClick={() => props.onPreference(-1)} aria-label="No me gusta"><ThumbsDown size={15} /></button>\n          </div>\n        </div>\n\n        <div className="library-room-unified-facts">\n          <dl className="library-room-game-facts">\n            <div><dt>Género</dt><dd>{steam?.genres?.length ? steam.genres.join(" · ") : "—"}</dd></div>\n            <div><dt>Multijugador</dt><dd>{modes.length ? modes.join(" · ") : "Un jugador / no informado"}</dd></div>\n            <div><dt>Desarrollador</dt><dd>{steam?.developers?.join(", ") || "—"}</dd></div>\n            <div><dt>Publisher</dt><dd>{steam?.publishers?.join(", ") || "—"}</dd></div>\n            <div><dt>Lanzamiento</dt><dd>{steam?.release_date || "—"}</dd></div>\n            <div><dt>Copias</dt><dd>{props.game.copies_available} / {props.game.copies_total} disponibles</dd></div>\n          </dl>\n          <div className="library-room-download-summary" aria-label="Descarga">\n            <div><span>Tamaño</span><strong>{formatDownloadBytes(props.download?.bytes_total)}</strong></div>\n            <div><span>Descargado</span><strong>{formatDownloadBytes(props.download?.bytes_downloaded)}</strong></div>\n            <div><span>Velocidad</span><strong>{formatDownloadSpeed(props.download?.speed_bps)}</strong></div>\n            <div><span>Tiempo restante</span><strong>{activeDownload ? formatDownloadEta(props.download?.eta_seconds) : "—"}</strong></div>\n            {activeDownload ? <div className="library-room-progress-inline"><span style={{ width: `${progress}%` }} /><strong>{Math.round(progress)}%</strong></div> : null}\n          </div>\n        </div>\n\n        {about ? <section className="library-room-copy-block"><h3>Acerca del juego</h3><p>{about}</p></section> : null}'''

new_panel = '''  return (\n    <aside className="library-room-feature">\n      <section className="library-room-first-row" aria-label="First row">\n        <MediaPanel {...props} />\n        <div className="library-room-first-row-overlay">\n          <header className="library-room-overview">\n            <span className="eyebrow">{props.showcaseMode ? "MODO VITRINA" : "TU BIBLIOTECA"}</span>\n            <h1>{props.game.name}</h1>\n            <p className="library-room-lead">{props.summary}</p>\n            {props.loadingDetails ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> Cargando ficha de Steam…</span> : null}\n          </header>\n\n          <div className="library-room-control-row">\n            <div className="library-room-actions glass-actions-row">\n              {props.actions.map((action, index) => (\n                <button type="button" key={`${action.kind}-${action.label}`} ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} data-action={action.kind} title={action.reason ?? undefined} className={`glass-action ${action.kind === "play" ? "play" : action.kind === "cancel" ? "cancel" : "download"} ${props.focusZone === "actions" && props.actionIndex === index ? "is-selected" : ""}`} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} onClick={() => props.onAction(index)} disabled={action.disabled}>\n                  <span className="glass-action-icon">{action.icon}</span><span className="glass-action-label">{action.label}</span>\n                </button>\n              ))}\n            </div>\n            <div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>\n              <span>¿Te gusta?</span>\n              <button type="button" className={props.preference === 1 ? "selected" : ""} onClick={() => props.onPreference(1)} aria-label="Me gusta"><ThumbsUp size={15} /></button>\n              <button type="button" className={props.preference === -1 ? "selected negative" : ""} onClick={() => props.onPreference(-1)} aria-label="No me gusta"><ThumbsDown size={15} /></button>\n            </div>\n          </div>\n        </div>\n      </section>\n\n      <div className="library-room-feature-copy">\n        <section className="library-room-second-row" aria-label="Second row">\n          <div className="library-room-unified-facts">\n            <dl className="library-room-game-facts">\n              <div><dt>Género</dt><dd>{steam?.genres?.length ? steam.genres.join(" · ") : "—"}</dd></div>\n              <div><dt>Multijugador</dt><dd>{modes.length ? modes.join(" · ") : "Un jugador / no informado"}</dd></div>\n              <div><dt>Desarrollador</dt><dd>{steam?.developers?.join(", ") || "—"}</dd></div>\n              <div><dt>Publisher</dt><dd>{steam?.publishers?.join(", ") || "—"}</dd></div>\n              <div><dt>Lanzamiento</dt><dd>{steam?.release_date || "—"}</dd></div>\n              <div><dt>Copias</dt><dd>{props.game.copies_available} / {props.game.copies_total} disponibles</dd></div>\n            </dl>\n            <div className="library-room-download-summary" aria-label="Descarga">\n              <div><span>Tamaño</span><strong>{formatDownloadBytes(props.download?.bytes_total)}</strong></div>\n              <div><span>Descargado</span><strong>{formatDownloadBytes(props.download?.bytes_downloaded)}</strong></div>\n              <div><span>Velocidad</span><strong>{formatDownloadSpeed(props.download?.speed_bps)}</strong></div>\n              <div><span>Tiempo restante</span><strong>{activeDownload ? formatDownloadEta(props.download?.eta_seconds) : "—"}</strong></div>\n              {activeDownload ? <div className="library-room-progress-inline"><span style={{ width: `${progress}%` }} /><strong>{Math.round(progress)}%</strong></div> : null}\n            </div>\n          </div>\n        </section>\n\n        {about ? <section className="library-room-copy-block library-room-third-row" aria-label="Third row"><h3>Acerca del juego</h3><SteamRichText html={about} /></section> : null}'''
parts = replace_once(parts, old_panel, new_panel, "three detail rows")
PARTS.write_text(parts, encoding="utf-8")

room = ROOM.read_text(encoding="utf-8")
room = replace_once(
    room,
    '  const videoSrc = isTabletSurface ? undefined : selectedVideo(movie);',
    '  const videoSrc = isDisplaySurface ? selectedVideo(movie) : undefined;',
    "desktop detail static artwork",
)
ROOM.write_text(room, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
refinement = r'''

/* Stage 2 detail refinement: named First/Second/Third rows. */
@media (min-width: 761px) {
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-first-row {
    position: relative;
    width: 100%;
    aspect-ratio: 2 / 3;
    min-height: 760px;
    overflow: hidden;
    border-bottom: 1px solid rgba(255,255,255,.12);
    background: #070a0f;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-first-row .library-room-feature-media {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    margin: 0 !important;
    border: 0 !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-first-row .library-room-hero-layer {
    object-fit: contain !important;
    object-position: center center !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-first-row-overlay {
    position: absolute;
    z-index: 5;
    inset: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 38px 26px 26px;
    background: linear-gradient(180deg, transparent 48%, rgba(3,5,8,.18) 62%, rgba(3,5,8,.88) 88%, rgba(3,5,8,.97) 100%);
    pointer-events: none;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-first-row-overlay .library-room-overview,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-first-row-overlay .library-room-control-row {
    pointer-events: auto;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview {
    min-height: 0 !important;
    padding: 0 0 18px !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview::before { display: none !important; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview h1 {
    margin: 0 0 10px !important;
    text-shadow: 0 3px 18px rgba(0,0,0,.98), 0 12px 42px rgba(0,0,0,.76) !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-lead {
    margin: 0 !important;
    color: rgba(246,249,252,.92) !important;
    font-size: 13px !important;
    line-height: 1.48 !important;
    text-shadow: 0 2px 12px rgba(0,0,0,.98) !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-control-row {
    width: 100%;
    margin: 0 !important;
    padding: 16px 0 0 !important;
    border-top: 1px solid rgba(255,255,255,.18) !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-copy {
    margin: 0 !important;
    padding: 0 26px 44px !important;
    background: #070a0f !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-second-row {
    margin: 0 -26px;
    padding: 26px;
    border-bottom: 1px solid rgba(255,255,255,.11);
    background: #070a0f;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-second-row .library-room-unified-facts {
    padding: 0 !important;
    border: 0 !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-third-row {
    margin: 0 -26px !important;
    padding: 30px 26px 32px !important;
    border-bottom: 1px solid rgba(255,255,255,.10) !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-third-row h3 {
    margin-bottom: 16px !important;
    font-size: 13px !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text {
    color: #c6d0db;
    font-size: 14px;
    line-height: 1.68;
    overflow-wrap: anywhere;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text p,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text div {
    margin: 0 0 14px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text ul,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text ol {
    margin: 10px 0 16px;
    padding-left: 24px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text li { margin: 6px 0; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h1,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h2,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h3,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h4 {
    margin: 20px 0 10px;
    color: #f2f6fa;
    line-height: 1.2;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h1 { font-size: 22px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h2 { font-size: 19px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h3 { font-size: 17px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h4 { font-size: 15px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 18px auto;
    border-radius: 10px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-game-facts dt,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-download-summary span {
    font-size: 10px !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-game-facts dd,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-download-summary strong {
    font-size: 12px !important;
  }

  .library-room.is-maximized:not(.surface-display):not(.surface-tablet) .library-room-first-row {
    aspect-ratio: auto;
    height: clamp(520px, 63vh, 720px);
    min-height: 520px;
  }
  .library-room.is-maximized:not(.surface-display):not(.surface-tablet) .library-room-first-row .library-room-hero-layer {
    object-fit: cover !important;
  }
}
'''
if "Stage 2 detail refinement: named First/Second/Third rows" not in css:
    css += refinement
CSS.write_text(css, encoding="utf-8")

if DOC.exists():
    doc = DOC.read_text(encoding="utf-8")
    row_contract = '''\n## Detail panel row terminology\n\nFor Stage 2 visual discussions, the desktop game detail panel uses these stable names:\n\n- **First row**: Steam artwork/slideshow plus the game title, short description, primary Play/Download/Cancel action, and like/dislike controls. The artwork is the visual background of the entire row, including the controls.\n- **Second row**: factual game metadata (genre, multiplayer, developer, publisher, release, copies and download facts). Steam-derived fields remain factual and are not marketing copy.\n- **Third row**: Steam “About the game” content, preserving readable paragraph/list emphasis instead of flattening the HTML into one line.\n- Additional sections (requirements, screenshots, etc.) follow below and remain reachable by scrolling.\n- Normal/restored desktop keeps the 50/50 detail/grid split and makes the First row tall enough for the portrait Steam Library Capsule without cropping. Maximized desktop uses the detail-heavy 70/30 split and wide high-resolution Steam hero/screenshots.\n'''
    if "## Detail panel row terminology" not in doc:
        doc += row_contract
        DOC.write_text(doc, encoding="utf-8")
