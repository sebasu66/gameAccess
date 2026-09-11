import { useCallback, useEffect, useState } from "react";
import { Download, Gauge, Loader2, MonitorCheck, Play, Settings, Star, Trophy, X } from "lucide-react";

import { loadDetails } from "./api";
import { gameStateManager } from "./GameStateManager";

import { type MachineProfile, type SteamDownloadStatus } from "./native";
import type { CatalogGame, GameDetails, SteamMetadata } from "./types";

import { stripHtml, wait, availabilityLabel, heavinessLabel, GlassActionButton } from "./AppPresentation";
export function DetailPanel({
  game,
  machine,
  download,
  onClose,
  onLease,
  onDownload,
  busy,
  overLibrary = false,
}: {
  game: CatalogGame;
  machine: MachineProfile | null;
  download?: SteamDownloadStatus;
  onClose: () => void;
  onLease: (game: CatalogGame) => Promise<void>;
  onDownload: (game: CatalogGame) => Promise<void>;
  busy: boolean;
  overLibrary?: boolean;
}) {
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeShot, setActiveShot] = useState(0);
  const [closing, setClosing] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const closeWithAnimation = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 220);
  }, [closing, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (optionsOpen) setOptionsOpen(false); else closeWithAnimation();
        return;
      }
      const actions = optionsOpen ? [] : [
        ...Array.from(document.querySelectorAll<HTMLButtonElement>(".detail-primary-actions button:not(:disabled)")),
        ...Array.from(document.querySelectorAll<HTMLButtonElement>(".detail-corner-actions button:not(:disabled)")),
      ];
      if (!optionsOpen && event.key === "Enter" && !(document.activeElement instanceof HTMLButtonElement)) {
        event.preventDefault();
        actions[0]?.click();
        return;
      }
      if (!optionsOpen && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "d", "w", "s"].includes(event.key)) {
        if (!actions.length) return;
        event.preventDefault();
        const current = Math.max(0, actions.indexOf(document.activeElement as HTMLButtonElement));
        const backwards = ["ArrowLeft", "ArrowUp", "a", "w"].includes(event.key);
        actions[(current + (backwards ? -1 : 1) + actions.length) % actions.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeWithAnimation, optionsOpen]);

  // Refocus the primary action when game selection or download state changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: These keys intentionally retrigger focus after the action changes.
  useEffect(() => {
    if (!optionsOpen) window.setTimeout(() => document.querySelector<HTMLButtonElement>(".detail-primary-actions button:not(:disabled)")?.focus(), 40);
  }, [optionsOpen, game.id, download?.state]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    setError(null);
    setActiveShot(0);
    loadDetails(game.id)
      .then((value) => !cancelled && setDetails(value))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [game.id]);

  const steam = details?.steam;
  const {description, hero, trailer} = detailMedia(steam, game);
  const weight = heavinessLabel(steam, machine);
  const localState = gameStateManager.resolve(download);
  const activeDownload = localState.transferActive;
  const playReady = localState.playButtonReady;
  const downloadBlocked = playReady || activeDownload || localState.storageBusy;
  const currentShot = steam?.screenshots?.[activeShot];

  const renderFacts = () => (<><aside className="facts-card">
              {steam?.genres?.length ? <div className="fact"><span>Géneros</span><strong>{steam.genres.slice(0, 6).join(" · ")}</strong></div> : null}
              {steam?.categories?.length ? <div className="fact"><span>Características</span><strong>{steam.categories.slice(0, 6).join(" · ")}</strong></div> : null}
              {steam?.developers?.length ? <div className="fact"><span>Desarrollador</span><strong>{steam.developers.join(", ")}</strong></div> : null}
              {steam?.publishers?.length ? <div className="fact"><span>Publisher</span><strong>{steam.publishers.join(", ")}</strong></div> : null}
              {steam?.recommendation_count ? <div className="fact"><span>Recomendaciones</span><strong>{steam.recommendation_count.toLocaleString("es-AR")}</strong></div> : null}
              {steam?.achievement_count ? <div className="fact"><span>Logros</span><strong><Trophy size={14} /> {steam.achievement_count}</strong></div> : null}
              {steam?.price?.final_formatted ? <div className="fact"><span>Precio Steam de referencia</span><strong>{steam.price.final_formatted}</strong></div> : null}
              {steam?.supported_languages ? <div className="fact"><span>Idiomas</span><strong>{stripHtml(steam.supported_languages).slice(0, 220)}</strong></div> : null}
            </aside>
          </>);

  const renderRequirements = () => (<>{(steam?.minimum_requirements || steam?.recommended_requirements) ? (
            <section className="requirements-block">
              <div className="section-title"><h3>Requisitos de PC</h3>{machine ? <span><MonitorCheck size={14} /> {machine.memory_gb ? `${machine.memory_gb.toFixed(0)} GB RAM detectados` : "PC detectada"}</span> : null}</div>
              <div className="requirements-grid">
                <div><span>Mínimos</span><p>{stripHtml(steam.minimum_requirements) || "No publicados"}</p></div>
                <div><span>Recomendados</span><p>{stripHtml(steam.recommended_requirements) || "No publicados"}</p></div>
              </div>
              {machine?.cpu ? <div className="machine-line"><strong>Tu CPU:</strong> {machine.cpu}</div> : null}
              {machine?.gpus?.length ? <div className="machine-line"><strong>Tu GPU:</strong> {machine.gpus.join(" · ")}</div> : null}
            </section>
          ) : null}
        </>);

  const renderGallery = () => (<>{steam?.screenshots?.length ? (
            <section className="screenshots-block gallery-block">
              <div className="section-title"><h3>Fotos</h3><span>{steam.screenshots.length} capturas oficiales</span></div>
              {currentShot ? <img className="gallery-main" src={currentShot.full || currentShot.thumbnail} alt={`${game.name} captura ${activeShot + 1}`} /> : null}
              <div className="screenshots-row gallery-thumbs">
                {steam.screenshots.slice(0, 12).map((shot, index) => (
                  <button type="button" key={`${shot.id ?? index}`} className={index === activeShot ? "active" : ""} onClick={() => setActiveShot(index)}>
                    <img src={shot.thumbnail || shot.full} alt={`Ver captura ${index + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          </>);

  const renderActions = () => (<><div className="detail-actions detail-primary-actions detail-keyboard-actions glass-actions-row">
              <GlassActionButton
                icon={busy ? <Loader2 size={23} className="spin" /> : <Play size={24} fill="currentColor" />}
                label={localState.frozen ? "Descongelar y jugar" : playReady ? "Jugar ahora" : activeDownload ? "Preparando" : "No listo"}
                tone="play" pulse={playReady && !busy}
                disabled={!playReady || busy}
                onClick={() => void onLease(game)}
              />
              <GlassActionButton
                icon={activeDownload ? <Loader2 size={23} className="spin" /> : <Download size={24} />}
                label={localState.installed ? "Instalado" : localState.prepared ? "Preparado" : localState.frozen ? "Congelado" : activeDownload ? (download?.progress != null ? `${Math.round(download.progress)}%` : "Preparando") : "Descargar"}
                tone="download" disabled={!game.app_id || downloadBlocked}
                onClick={() => void onDownload(game)}
              />
            </div>
          </>);

  const renderMetadata = () => (<><div className="detail-meta">
              <span className={game.copies_available > 0 ? "meta-ready" : "meta-wait"}>{availabilityLabel(game)}</span>
              {steam?.release_date ? <span>{steam.release_date}</span> : null}
              {steam?.metacritic?.score ? <span className="score"><Star size={13} fill="currentColor" /> {steam.metacritic.score}</span> : null}
              {weight ? <span className={`compatibility-pill ${weight.tone}`}><Gauge size={13} /> {weight.text}</span> : null}
            </div>
            </>);

  return (
    <div role="presentation" className={`modal-backdrop ${closing ? "is-closing" : ""} ${overLibrary ? "over-library" : ""}`} onPointerDown={closeWithAnimation}>
      <article className="detail-panel detail-panel-rich" onPointerDown={(event) => event.stopPropagation()}>
        <div className="detail-corner-actions detail-keyboard-actions">
          <button type="button" className="detail-gear" onClick={() => setOptionsOpen(true)} aria-label="Opciones del juego"><Settings size={20} /></button>
          <button type="button" className="close-detail" onClick={closeWithAnimation} aria-label="Volver"><X size={22} /></button>
        </div>
        <div className="detail-hero" style={hero ? { backgroundImage: `url("${hero}")` } : undefined}>
          {trailer?.mp4 ? (
            <video className="detail-hero-video" src={trailer.mp4} poster={trailer.thumbnail} autoPlay muted loop playsInline />
          ) : null}
          <div className="detail-hero-shade" />
          <div className="detail-hero-copy">
            <span className="eyebrow">FICHA DEL JUEGO</span>
            <h1>{steam?.name || game.name}</h1>
            {renderMetadata()}
        <p>{description}</p>
            {renderActions()}
        </div>
          <div className="hero-price detail-price"><span>Acceso</span><strong>GRATIS</strong><small>sin fichas</small></div>
        </div>

        <div className="detail-body detail-body-rich">
          {loading ? <div className="loading-line"><Loader2 size={18} className="spin" /> Obteniendo ficha completa desde Steam…</div> : null}
          {error ? <div className="detail-warning">No pudimos cargar la ficha extendida ahora. La biblioteca sigue disponible.</div> : null}

          {trailer?.mp4 ? (
            <section className="media-block">
              <div className="section-title"><h3>Tráiler</h3><span>{trailer.name || "Video oficial"}</span></div>
              {/* biome-ignore lint/a11y/useMediaCaption: Steam trailer metadata provides no caption track. Native player controls remain available. */}
              <video className="detail-trailer" controls playsInline poster={trailer.thumbnail}>
                <source src={trailer.mp4} type="video/mp4" />
                {trailer.webm ? <source src={trailer.webm} type="video/webm" /> : null}
              </video>
            </section>
          ) : null}

          {renderGallery()}
        <div className="detail-grid detail-grid-rich">
            <section className="about-card">
              <h3>Acerca del juego</h3>
              <p>{stripHtml(steam?.about_the_game) || description}</p>
              {steam?.detailed_description ? <p className="secondary-copy">{stripHtml(steam.detailed_description)}</p> : null}
            </section>
            {renderFacts()}
        </div>

          {renderRequirements()}
        </div>
        {optionsOpen ? <div role="presentation" className="game-options-backdrop" onPointerDown={() => setOptionsOpen(false)}><section className="game-options-dialog" onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Opciones del juego"><span className="eyebrow">ADMINISTRAR JUEGO</span><h2>{game.name}</h2><p>Opciones de instalación y mantenimiento.</p><button type="button" className="secondary-button" disabled>Desinstalar · próximamente</button><button type="button" className="secondary-button" onClick={() => setOptionsOpen(false)}>Volver</button></section></div> : null}
      </article>
    </div>
  );
}

function detailMedia(steam: SteamMetadata | null | undefined, game: CatalogGame) {
  const description = stripHtml(steam?.short_description || steam?.about_the_game) || "Elegí el juego, preparalo y gameAccess gestiona el acceso cuando tocás Jugar.";
  const hero = steam?.background || steam?.hero_image || game.hero_image || game.header_image || game.capsule_image || undefined;
  const trailer = steam?.movies?.find((movie) => movie.highlight) || steam?.movies?.[0];
  return {description, hero, trailer};
}
