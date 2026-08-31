import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Loader2,
  Network,
  Play,
  Settings,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  User,
  Users,
  Wifi,
  X,
} from "lucide-react";

import { loadDetails } from "./api";
import {
  accountSummary,
  gameCapabilities,
  hardwareWarning,
  installationSizeLabel,
  isSensitiveSteamContent,
  stripSteamHtml,
  type Capability,
} from "./gameDetailInfo";
import { getSteamStoreMetadata, type MachineProfile, type SteamDownloadStatus } from "./native";
import type { CatalogGame, GameDetails } from "./types";

interface MainGameDetailPanelProps {
  game: CatalogGame;
  machine: MachineProfile | null;
  download?: SteamDownloadStatus;
  busy: boolean;
  onClose: () => void;
  onPlay: (game: CatalogGame) => void | Promise<void>;
  onDownload: (game: CatalogGame) => void | Promise<void>;
  onHide: (game: CatalogGame) => void;
  onOpenInstallLocation?: (game: CatalogGame) => void | Promise<void>;
  onUninstall?: (game: CatalogGame) => void | Promise<void>;
}

const capabilityMeta: Record<Capability, { label: string; icon: typeof User }> = {
  single: { label: "1 jugador", icon: User },
  online: { label: "Multijugador online", icon: Wifi },
  local: { label: "Multijugador local", icon: Users },
  lan: { label: "LAN", icon: Network },
};

function CapabilityBadges({ values }: { values: Capability[] }) {
  if (!values.length) return null;
  return (
    <div className="main-detail-capabilities" aria-label="Modos de juego">
      {values.map((value) => {
        const meta = capabilityMeta[value];
        const Icon = meta.icon;
        return <span key={value}><Icon size={14} /> {meta.label}</span>;
      })}
    </div>
  );
}

function AccountBadges({ game }: { game: CatalogGame }) {
  const accounts = accountSummary(game);
  if (!accounts.length) return null;
  return (
    <div className="main-detail-origin" aria-label="Cuentas propietarias">
      <span className="main-detail-origin-label"><Gamepad2 size={14} /> Licencia</span>
      {accounts.map((account, index) => <span className="main-detail-account" key={`${account}-${index}`}>{account}</span>)}
    </div>
  );
}

function SensitiveMediaGate({ onReveal }: { onReveal: () => void }) {
  return (
    <div className="main-detail-sensitive-gate">
      <ShieldAlert size={34} />
      <strong>Contenido sensible</strong>
      <p>Steam marca este juego como contenido para adultos o con desnudez/contenido sexual. La vista previa está oculta.</p>
      <button type="button" onClick={onReveal}><Eye size={17} /> Ver contenido</button>
    </div>
  );
}

interface ManageMenuProps {
  game: CatalogGame;
  installed: boolean;
  onClose: () => void;
  onHide: () => void;
  onOpenInstallLocation?: () => void;
  onUninstall?: () => void;
}

function ManageMenu(props: ManageMenuProps) {
  return (
    <div className="main-detail-manage-backdrop" onMouseDown={props.onClose}>
      <section className="main-detail-manage" role="dialog" aria-modal="true" aria-label={`Administrar ${props.game.name}`} onMouseDown={(event) => event.stopPropagation()}>
        <span className="eyebrow">ADMINISTRAR JUEGO</span>
        <h3>{props.game.name}</h3>
        <button type="button" disabled={!props.installed || !props.onOpenInstallLocation} onClick={props.onOpenInstallLocation}><FolderOpen size={17} /> Abrir ubicación de instalación</button>
        <button type="button" className="danger" disabled={!props.installed || !props.onUninstall} onClick={props.onUninstall}><Trash2 size={17} /> Desinstalar</button>
        <button type="button" onClick={props.onHide}><EyeOff size={17} /> Ocultar de Inicio</button>
        <button type="button" className="secondary" onClick={props.onClose}>Volver</button>
      </section>
    </div>
  );
}

function heroImage(details: GameDetails | null, game: CatalogGame) {
  const steam = details?.steam;
  return steam?.background || steam?.hero_image || steam?.screenshots?.[0]?.full || game.hero_image || game.header_image || game.capsule_image || undefined;
}

export default function MainGameDetailPanel(props: MainGameDetailPanelProps) {
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [rawSteam, setRawSteam] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    setRawSteam(undefined);
    setRevealed(false);
    setManageOpen(false);

    const detailRequest = loadDetails(props.game.id)
      .then((value) => { if (!cancelled) setDetails(value); })
      .catch(() => { if (!cancelled) setDetails(null); });
    const rawRequest = props.game.app_id
      ? getSteamStoreMetadata(props.game.app_id)
        .then((value) => { if (!cancelled) setRawSteam(value); })
        .catch(() => { if (!cancelled) setRawSteam(null); })
      : Promise.resolve().then(() => { if (!cancelled) setRawSteam(null); });

    void Promise.allSettled([detailRequest, rawRequest]).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props.game.id, props.game.app_id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (manageOpen) setManageOpen(false);
      else props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [manageOpen, props.onClose]);

  const steam = details?.steam;
  const capabilities = useMemo(() => gameCapabilities(steam?.categories), [steam?.categories]);
  const warning = useMemo(() => hardwareWarning(steam, props.machine), [steam, props.machine]);
  const storage = useMemo(() => installationSizeLabel(steam, props.download), [steam, props.download]);
  const sensitive = isSensitiveSteamContent(steam, rawSteam ?? null);
  const sensitivityPending = props.game.app_id != null && rawSteam === undefined;
  const mediaBlocked = !revealed && (sensitive || sensitivityPending);
  const installed = Boolean(props.download?.installed || props.download?.state === "installed");
  const activeDownload = Boolean(props.download && ["requested", "preparing", "downloading", "paused"].includes(props.download.state));
  const hero = heroImage(details, props.game);
  const trailer = steam?.movies?.find((movie) => movie.highlight) ?? steam?.movies?.[0];
  const description = stripSteamHtml(steam?.short_description || steam?.about_the_game) || "Información del juego disponible en tu biblioteca consolidada.";

  const play = () => { void props.onPlay(props.game); };
  const download = () => { void props.onDownload(props.game); };
  const hide = () => { props.onHide(props.game); setManageOpen(false); props.onClose(); };
  const openLocation = props.onOpenInstallLocation ? () => { void props.onOpenInstallLocation?.(props.game); } : undefined;
  const uninstall = props.onUninstall ? () => { void props.onUninstall?.(props.game); } : undefined;

  return (
    <div className="main-detail-backdrop" onMouseDown={props.onClose}>
      <article className="main-detail-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header className="main-detail-hero" style={!mediaBlocked && hero ? { backgroundImage: `url("${hero}")` } : undefined}>
          {!mediaBlocked && trailer?.mp4 ? <video className="main-detail-hero-video" src={trailer.mp4} poster={trailer.thumbnail} autoPlay muted loop playsInline /> : null}
          <div className="main-detail-hero-shade" />
          {mediaBlocked ? <SensitiveMediaGate onReveal={() => setRevealed(true)} /> : null}
          <div className="main-detail-corner-actions">
            <button type="button" onClick={() => setManageOpen(true)} aria-label="Administrar juego"><Settings size={20} /></button>
            <button type="button" onClick={props.onClose} aria-label="Cerrar"><X size={21} /></button>
          </div>
          <div className="main-detail-title">
            <span className="eyebrow">FICHA DEL JUEGO</span>
            <h2>{steam?.name || props.game.name}</h2>
            <p>{description}</p>
            <div className="main-detail-actions">
              <button type="button" className="play" disabled={!installed || props.busy || props.game.copies_available <= 0} onClick={play}><Play size={20} fill="currentColor" /> Jugar</button>
              <button type="button" disabled={!props.game.app_id || installed || activeDownload} onClick={download}>{activeDownload ? <Loader2 size={19} className="spin" /> : <Download size={19} />} {installed ? "Instalado" : activeDownload ? (props.download?.progress != null ? `${Math.round(props.download.progress)}%` : "Preparando") : "Descargar"}</button>
            </div>
          </div>
        </header>

        <div className="main-detail-body">
          {loading ? <div className="main-detail-loading"><Loader2 size={15} className="spin" /> Cargando datos de Steam…</div> : null}
          <section className="main-detail-facts-strip">
            <CapabilityBadges values={capabilities} />
            <AccountBadges game={props.game} />
            {storage ? <span className="main-detail-storage"><HardDrive size={14} /> {storage}</span> : null}
          </section>

          {warning ? <div className="main-detail-hardware-warning"><TriangleAlert size={19} /><div><strong>{warning.title}</strong><span>{warning.detail}</span></div></div> : null}

          <div className="main-detail-columns">
            <section>
              <h3>Acerca del juego</h3>
              <p>{stripSteamHtml(steam?.about_the_game) || description}</p>
            </section>
            <aside>
              {steam?.genres?.length ? <div><span>Géneros</span><strong>{steam.genres.slice(0, 5).join(" · ")}</strong></div> : null}
              {steam?.release_date ? <div><span>Lanzamiento</span><strong>{steam.release_date}</strong></div> : null}
              {steam?.developers?.length ? <div><span>Desarrollador</span><strong>{steam.developers.slice(0, 2).join(", ")}</strong></div> : null}
              {steam?.minimum_requirements ? <div><span>Mínimos</span><strong>{stripSteamHtml(steam.minimum_requirements).slice(0, 260)}</strong></div> : null}
            </aside>
          </div>
        </div>

        {manageOpen ? (
          <ManageMenu
            game={props.game}
            installed={installed}
            onClose={() => setManageOpen(false)}
            onHide={hide}
            onOpenInstallLocation={openLocation}
            onUninstall={uninstall}
          />
        ) : null}
      </article>
    </div>
  );
}
