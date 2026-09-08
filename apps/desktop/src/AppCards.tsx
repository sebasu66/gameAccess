
import { Check, ChevronRight, Download, Gamepad2, Gauge, Play, ThumbsDown, ThumbsUp } from "lucide-react";

import { type MachineProfile, type SteamDownloadStatus } from "./native";
import type { CatalogGame, GameDetails } from "./types";

import { wait, Preference, DownloadMap, availabilityLabel, heavinessLabel } from "./AppPresentation";
function GameCard({
  game,
  details,
  machine,
  download,
  preference,
  showPreference = false,
  onOpen,
  onPreference,
}: {
  game: CatalogGame;
  details?: GameDetails;
  machine?: MachineProfile | null;
  download?: SteamDownloadStatus;
  preference?: Preference;
  showPreference?: boolean;
  onOpen: (game: CatalogGame) => void;
  onPreference: (gameId: number, value: Preference) => void;
}) {
  const activeDownload = download && ["requested", "preparing", "downloading"].includes(download.state);
  const progress = Math.max(0, Math.min(100, download?.progress ?? 0));
  const weight = heavinessLabel(details?.steam, machine);

  return (
    <article className={`game-card ${activeDownload ? "is-downloading" : ""}`} style={{ "--download-progress": `${progress}%` } as React.CSSProperties}>
      <button type="button" className="game-card-main" onClick={() => onOpen(game)} aria-label={`Abrir ${game.name}`}>
        <div className="game-card-art">
          {game.capsule_image ? (
            <>
              <img className="card-art-base" src={game.capsule_image} alt="" loading="lazy" />
              {activeDownload ? <img className="card-art-color-fill" src={game.capsule_image} alt="" aria-hidden="true" /> : null}
            </>
          ) : (
            <div className="game-card-fallback"><Gamepad2 size={42} /></div>
          )}
          <div className="game-card-gradient" />
          <span className={`availability-chip ${game.copies_available > 0 ? "ready" : "wait"}`}>
            <span className="dot" /> {availabilityLabel(game)}
          </span>
          {weight ? <span className={`hardware-chip ${weight.tone}`}><Gauge size={12} /> {weight.text}</span> : null}
          {activeDownload ? (
            <div className="download-card-status">
              <Download size={15} />
              <strong>{download?.progress != null ? `${Math.round(download.progress)}%` : "Preparando…"}</strong>
            </div>
          ) : null}
          {download?.state === "installed" ? <span className="installed-chip"><Check size={12} /> Listo</span> : null}
          <div className="game-card-hover">
            <span className="round-play"><Play size={18} fill="currentColor" /></span>
            <span className="card-price">GRATIS</span>
          </div>
        </div>
        <div className="game-card-copy">
          <strong>{game.name}</strong>
          {download?.state === "installed" ? <span>Instalado · listo para jugar</span> : null}
        </div>
      </button>
      {showPreference ? (
        <div role="group" className="preference-controls" aria-label={`Preferencia para ${game.name}`}>
          <button type="button" className={preference === 1 ? "selected" : ""} onClick={() => onPreference(game.id, 1)} aria-label="Me gusta"><ThumbsUp size={16} /></button>
          <button type="button" className={preference === -1 ? "selected negative" : ""} onClick={() => onPreference(game.id, -1)} aria-label="No me gusta"><ThumbsDown size={16} /></button>
        </div>
      ) : null}
    </article>
  );
}

export function Shelf({
  title,
  subtitle,
  games,
  detailsById,
  machine,
  downloads,
  preferences,
  showPreference = false,
  onOpen,
  onPreference,
  onViewAll,
}: {
  title: string;
  subtitle?: string;
  games: CatalogGame[];
  detailsById: Partial<Record<number, GameDetails>>;
  machine: MachineProfile | null;
  downloads: DownloadMap;
  preferences: Record<number, Preference>;
  showPreference?: boolean;
  onOpen: (game: CatalogGame) => void;
  onPreference: (gameId: number, value: Preference) => void;
  onViewAll?: () => void;
}) {
  if (!games.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-heading">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {onViewAll ? <button type="button" className="text-action" onClick={onViewAll}>Ver más <ChevronRight size={16} /></button> : null}
      </div>
      <div className="cards-row">
        {games.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            details={detailsById[game.id]}
            machine={machine}
            download={game.app_id ? downloads[game.app_id] : undefined}
            preference={preferences[game.id]}
            showPreference={showPreference}
            onOpen={onOpen}
            onPreference={onPreference}
          />
        ))}
      </div>
    </section>
  );
}

