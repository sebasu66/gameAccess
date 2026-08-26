import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2, ShoppingCart, X } from "lucide-react";

import { loadSteamApp } from "./api";
import type { SteamMetadata, SteamSearchResult } from "./types";
import "./steam-store-detail.css";

function stripHtml(value?: string) {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPrice(result: SteamSearchResult, steam?: SteamMetadata | null) {
  const searchPrice = result.price;
  const metadataPrice = steam?.price;
  const currency = searchPrice?.currency || metadataPrice?.currency;
  const final = searchPrice?.final ?? metadataPrice?.final;
  if (!currency || final == null) return null;
  if (final === 0) return "Gratis";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(final / 100);
  } catch {
    return `${(final / 100).toFixed(2)} ${currency}`;
  }
}

type Props = {
  result: SteamSearchResult;
  onClose: () => void;
};

export default function SteamStoreDetail({ result, onClose }: Props) {
  const [steam, setSteam] = useState<SteamMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [shot, setShot] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    setSteam(null);
    setShot(0);
    loadSteamApp(result.app_id)
      .then((value) => !cancelled && setSteam(value))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [result.app_id]);

  const trailer = steam?.movies?.find((movie) => movie.highlight) || steam?.movies?.[0];
  const hero = steam?.background || steam?.hero_image || steam?.header_image || result.image_url || undefined;
  const description = stripHtml(steam?.short_description || steam?.about_the_game) || "Ficha disponible desde el catálogo de Steam.";
  const price = formatPrice(result, steam);
  const screenshots = useMemo(() => steam?.screenshots?.slice(0, 8) ?? [], [steam]);
  const currentShot = screenshots[shot];

  const requestDownload = () => {
    setMessage("La ficha ya está preparada. Steam exige una licencia válida antes de entregar los archivos del juego. Cuando compres o vincules una licencia, GameAccess podrá continuar automáticamente con la descarga.");
  };

  const requestBuy = () => {
    setMessage(`Compra de ${result.name}: ya tenemos el AppID y el precio oficial de Steam. La próxima capa agregará ofertas externas —por ejemplo G2G— y el precio final de GameAccess.`);
  };

  return (
    <div className="modal-backdrop steam-store-backdrop" onMouseDown={onClose}>
      <article className="steam-store-detail" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-detail" onClick={onClose} aria-label="Cerrar"><X size={22} /></button>

        <section className="steam-store-hero" style={hero ? { backgroundImage: `url("${hero}")` } : undefined}>
          {trailer?.mp4 ? <video className="steam-store-video" src={trailer.mp4} poster={trailer.thumbnail} autoPlay muted loop playsInline /> : null}
          <div className="steam-store-shade" />
          <div className="steam-store-copy">
            <span className="eyebrow">CATÁLOGO STEAM</span>
            <h1>{steam?.name || result.name}</h1>
            <div className="steam-store-meta">
              <span className="steam-store-not-owned">Todavía sin licencia GameAccess</span>
              {steam?.release_date ? <span>{steam.release_date}</span> : null}
              {price ? <strong>Steam {price}</strong> : null}
            </div>
            <p>{description}</p>

            <div className="steam-store-actions">
              <button className="steam-store-action download" onClick={requestDownload}>
                <Download size={21} /> Descargar
              </button>
              <button className="steam-store-action buy" onClick={requestBuy}>
                <ShoppingCart size={21} /> Comprar
              </button>
              {result.steam_url ? (
                <button className="steam-store-icon-action" onClick={() => window.open(result.steam_url, "_blank", "noopener,noreferrer")} aria-label="Abrir en Steam">
                  <ExternalLink size={18} />
                </button>
              ) : null}
            </div>
            {message ? <div className="steam-store-message">{message}</div> : null}
            <small className="steam-store-note">
              La ficha puede verse sin licencia. Compra y descarga son acciones separadas para que GameAccess pueda vincular automáticamente el acceso adquirido y continuar con la instalación.
            </small>
          </div>
        </section>

        <div className="steam-store-body">
          {loading ? <div className="steam-store-loading"><Loader2 className="spin" size={18} /> Cargando ficha completa desde Steam…</div> : null}
          {error ? <div className="steam-store-error">No pudimos completar la ficha: {error}</div> : null}

          {currentShot?.full ? (
            <section className="steam-store-gallery">
              <img src={currentShot.full} alt="" />
              <div>
                {screenshots.map((item, index) => (
                  <button key={item.id ?? index} className={index === shot ? "active" : ""} onClick={() => setShot(index)}>
                    <img src={item.thumbnail || item.full} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="steam-store-purchase-preview">
            <div>
              <span>Compra</span>
              <h3>Una sola ficha, varias formas de conseguir acceso</h3>
              <p>Hoy mostramos el precio oficial de Steam como referencia. El modelo ya queda preparado para sumar ofertas externas normalizadas, aplicar margen y mostrar una opción de compra dentro de GameAccess.</p>
            </div>
            <div className="steam-store-price-box">
              <small>Steam</small>
              <strong>{price || "Consultar"}</strong>
              <span>App {result.app_id}</span>
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}
