import { useEffect, useState } from "react";
import { Download, Loader2, MoreHorizontal, X } from "lucide-react";
import { useI18n } from "./i18n";
import { downloadButtonLabel } from "./downloadSize";
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { getPluginSources, type PluginSource } from "./catalog/PluginSources";
import type { CatalogGame } from "./types";
import "./plugin-sources.css";

export function pluginDownloadLabel(game: CatalogGame, sources: PluginSource[], locale: "es" | "en"): string {
  const size = sources[0]?.size || "";
  const label = downloadButtonLabel({ ...game, download_size: size, download_size_bytes: null }, locale);
  return label + " [" + sources.length + (locale === "es" ? " fuentes]" : " sources]");
}
export default function PluginDownloadButton({ game, disabled = false }: { game: CatalogGame; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<{ key: string; sources: PluginSource[]; loading: boolean }>({ key: "", sources: [], loading: true });
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const key = String(game.app_id ?? game.id) + "|" + game.name;
  const current = result.key === key ? result : { sources: [], loading: true };
  useEffect(() => {
    let cancelled = false;
    setOpen(false); setError(""); setStarting(false);
    setResult({ key, sources: [], loading: true });
    const refresh = async () => {
      const sources = await getPluginSources(game);
      if (!cancelled) setResult({ key, sources, loading: false });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [key]);
  const start = async (source: PluginSource) => {
    if (starting || disabled) return;
    setStarting(true); setError("");
    try { await digitalCatalogService.download(game, source); setOpen(false); }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      digitalDownloadService.recordFailure(game, message); setError(message);
    } finally { setStarting(false); }
  };
  return <div className="plugin-download-action">
    <button type="button" className="glass-action download" data-action="download"
      disabled={disabled || starting || current.loading || !current.sources.length}
      onClick={() => { const source = current.sources[0]; if (source) void start(source); }}>
      <span className="glass-action-icon">{current.loading || starting ? <Loader2 size={23} className="spin" /> : <Download size={23} />}</span>
      <span className="glass-action-label">{current.loading ? t("sourcesChecking") : current.sources.length ? pluginDownloadLabel(game, current.sources, locale) : t("sourcesUnavailable")}</span>
    </button>
    <button type="button" className="source-options-toggle" disabled={!current.sources.length || disabled || starting}
      onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={t("sourcesOptions")}><MoreHorizontal size={20} /></button>
    {open && <section className="source-selector-panel" aria-label={t("sourcesChoose")}>
      <div className="source-selector-heading"><strong>{t("sourcesChoose")}</strong><button type="button" onClick={() => setOpen(false)} aria-label={t("close")}><X size={18} /></button></div>
      <div className="source-selector-list">{current.sources.map(source => <button type="button" key={source.url}
        disabled={disabled || starting} onClick={() => void start(source)}>
        <strong>{source.title}</strong><small>{source.sourceName} · {source.size || t("downloadsSizeUnknown")}</small>
        <span>{downloadButtonLabel({ ...game, download_size: source.size, download_size_bytes: null }, locale)}</span>
      </button>)}</div>
    </section>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
