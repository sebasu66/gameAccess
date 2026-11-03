import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileJson, Plus, Search, Trash2, X } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { confirmNotice, showNotice } from "./notice/notice";
import { pollPluginRuntime, type PluginStatus } from "./catalog/PluginRuntime";
import { unregisterPluginSources } from "./catalog/PluginSources";
import {
  addPluginFeed, addPluginFeedFile, canManage, pluginFeeds, pluginHealth, pluginLink, removePluginFeed, searchPlugin, uninstallPlugin,
  type PluginFeeds, type PluginHealth, type PluginSearchResult,
} from "./catalog/PluginManage";
import ManualLinkDialog from "./library-manager/ManualLinkDialog";
import { RowMenu } from "./library-manager/RowExpand";
import "./library-manager/manager.css";
import "./plugin-settings.css";

const copy = {
  es: {
    online: "Conectado", offline: "No responde", endpoint: "Dirección", sources: (n: number) => `${n} descargas en sus listas`,
    feeds: "Listas de descargas", feedsHint: "Las listas (JSON) de donde el plugin saca los links. Podés sumar una por su dirección o cargar un archivo de esta PC.",
    feedUrl: "Dirección de la lista (https://…)", addFeed: "Agregar", loadFile: "Cargar archivo JSON", removeFeed: "Quitar", syncing: "Leyendo las listas…",
    search: "Buscar en sus registros", searchPlaceholder: "Nombre del juego", searchButton: "Buscar", none: "No hay resultados.",
    resultsHint: "Clic derecho (o el botón ⋯) en un resultado para descargarlo.", actions: "Acciones",
    download: "Descargar", copyLink: "Copiar link", copied: "Link copiado.",
    uninstall: "Desinstalar el plugin", uninstallTitle: (name: string) => `¿Desinstalar ${name}?`,
    uninstallText: "Se cierra y se borra su carpeta. Los juegos que ya bajaste quedan; sin el plugin no vas a ver sus links en el catálogo.",
    uninstalled: (name: string) => `${name} se desinstaló.`, cancel: "Cancelar",
    noManage: "Esta versión del plugin no ofrece sus listas ni su búsqueda a Game Access. Actualizalo para verlas acá.",
    offlineHint: "El plugin no está corriendo. Game Access lo abre solo al iniciar; si sigue sin responder, reinstalalo.",
  },
  en: {
    online: "Connected", offline: "Not responding", endpoint: "Address", sources: (n: number) => `${n} downloads in its lists`,
    feeds: "Download lists", feedsHint: "The lists (JSON) the plugin takes its links from. Add one by its address or load a file from this PC.",
    feedUrl: "List address (https://…)", addFeed: "Add", loadFile: "Load JSON file", removeFeed: "Remove", syncing: "Reading the lists…",
    search: "Search its records", searchPlaceholder: "Game name", searchButton: "Search", none: "No results.",
    resultsHint: "Right click (or the ⋯ button) on a result to download it.", actions: "Actions",
    download: "Download", copyLink: "Copy link", copied: "Link copied.",
    uninstall: "Uninstall the plugin", uninstallTitle: (name: string) => `Uninstall ${name}?`,
    uninstallText: "It is closed and its folder deleted. Games you already downloaded stay; without the plugin you will not see its links in the catalog.",
    uninstalled: (name: string) => `${name} was uninstalled.`, cancel: "Cancel",
    noManage: "This version of the plugin does not offer its lists or its search to Game Access. Update it to see them here.",
    offlineHint: "The plugin is not running. Game Access opens it when it starts; if it still does not respond, reinstall it.",
  },
};

/** A game's name from a download's title ("Cyberpunk 2077 v2.1 [SteamRIP]" → "Cyberpunk 2077"), to look it up in the catalog. */
export const titleQuery = (title: string) => title.replace(/[[(].*?[\])]/g, " ").replace(/\b(?:v|build|update)\s*\d[\w.]*.*$/i, " ").replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();

/** A plugin's tab in Settings: whether it answers, its download lists (add by address or from a file, remove), a search
 *  among its records whose results download with a right click, and uninstalling it. */
export default function PluginSettings({ plugin }: { plugin: PluginStatus }) {
  const { locale } = useI18n(); const c = copy[locale];
  const [health, setHealth] = useState<PluginHealth | null>(null);
  const [feeds, setFeeds] = useState<PluginFeeds | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PluginSearchResult[] | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; result: PluginSearchResult } | null>(null);
  const [download, setDownload] = useState<{ url: string; query: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const manage = canManage(health);

  useEffect(() => {
    let live = true;
    setHealth(null); setFeeds(null); setResults(null);
    if (!plugin.alive) return;
    void pluginHealth(plugin).then(found => {
      if (!live) return;
      setHealth(found);
      if (canManage(found)) void pluginFeeds(plugin).then(list => { if (live) setFeeds(list); }).catch(failure => { if (live) setError(text(failure)); });
    }).catch(failure => { if (live) setError(text(failure)); });
    return () => { live = false; };
  }, [plugin.id, plugin.endpoint, plugin.alive]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (failure) { setError(text(failure)); } finally { setBusy(false); }
  };
  const addFeed = () => run(async () => { setFeeds(await addPluginFeed(plugin, feedUrl.trim())); setFeedUrl(""); });
  const loadFile = (chosen: File | undefined) => chosen && run(async () => { setFeeds(await addPluginFeedFile(plugin, chosen.name, await chosen.text())); });
  const search = () => query.trim() && run(async () => { setResults(await searchPlugin(plugin, query.trim())); });
  const startDownload = (result: PluginSearchResult) => run(async () => {
    const link = await pluginLink(plugin, result.url).catch(() => ({ url: result.url }));
    setDownload({ url: link.url || result.url, query: titleQuery(result.title) });
  });
  const uninstall = async () => {
    if (!await confirmNotice({ title: c.uninstallTitle(plugin.name), text: c.uninstallText, confirmLabel: c.uninstall, cancelLabel: c.cancel, kind: "danger" })) return;
    await run(async () => {
      await uninstallPlugin(plugin.id);
      await unregisterPluginSources(plugin.id);
      await pollPluginRuntime();
      showNotice({ title: c.uninstalled(plugin.name), tone: "ok" });
    });
  };
  const openMenu = (event: React.MouseEvent, result: PluginSearchResult) => { event.preventDefault(); setMenu({ at: { x: event.clientX, y: event.clientY }, result }); };

  return <section className="ga-plugin-settings ga-stack">
    <h3 className="ga-plugin-title">{plugin.name}</h3>
    <p className="ga-hint">
      <span className={plugin.alive ? "ga-plugin-state is-on" : "ga-plugin-state"}>{plugin.alive ? c.online : c.offline}</span>
      {" · "}{c.endpoint}: <code>{plugin.endpoint}</code>{feeds ? <>{" · "}{c.sources(feeds.sourceCount)}</> : null}
    </p>
    {!plugin.alive ? <p className="ga-hint">{c.offlineHint}</p> : health && !manage ? <p className="ga-hint">{c.noManage}</p> : null}

    {manage ? <>
      <fieldset className="ga-group ga-plugin-group">
        <legend className="ga-label">{c.feeds}</legend>
        <p className="ga-hint">{c.feedsHint}</p>
        {feeds?.syncing ? <p className="ga-status" role="status">{c.syncing}</p> : null}
        <ul className="ga-plugin-feeds">
          {(feeds?.feeds ?? []).map(feed => <li key={feed}>
            <code title={feed}>{feed}</code>
            <button type="button" className="ga-plugin-icon" aria-label={`${c.removeFeed}: ${feed}`} title={c.removeFeed} disabled={busy}
              onClick={() => void run(async () => { setFeeds(await removePluginFeed(plugin, feed)); })}><X size={16} aria-hidden="true" /></button>
          </li>)}
        </ul>
        <form className="ga-plugin-row" onSubmit={event => { event.preventDefault(); void addFeed(); }}>
          <input aria-label={c.feedUrl} placeholder={c.feedUrl} value={feedUrl} disabled={busy} spellCheck={false} onChange={event => setFeedUrl(event.target.value)} />
          <GaButton type="submit" icon={<Plus size={16} />} disabled={busy || !/^https?:\/\//i.test(feedUrl.trim())}>{c.addFeed}</GaButton>
          <GaButton icon={<FileJson size={16} />} disabled={busy} onClick={() => file.current?.click()}>{c.loadFile}</GaButton>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
        </form>
      </fieldset>

      <fieldset className="ga-group ga-plugin-group">
        <legend className="ga-label">{c.search}</legend>
        <form className="ga-plugin-row" role="search" onSubmit={event => { event.preventDefault(); void search(); }}>
          <input aria-label={c.search} placeholder={c.searchPlaceholder} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} />
          <GaButton type="submit" variant="primary" icon={<Search size={16} />} disabled={busy || !query.trim()}>{c.searchButton}</GaButton>
        </form>
        {results ? results.length ? <>
          <p className="ga-hint">{c.resultsHint}</p>
          <ul className="ga-plugin-results">
            {results.map(result => <li key={result.url + result.title} onContextMenu={event => openMenu(event, result)}>
              <span className="ga-plugin-result-title" title={result.title}>{result.title}</span>
              <span className="ga-plugin-result-meta">{[result.size ? String(result.size) : "", result.source ? sourceName(result.source) : ""].filter(Boolean).join(" · ")}</span>
              <button type="button" className="ga-plugin-icon" aria-label={`${c.actions}: ${result.title}`} title={c.actions} aria-haspopup="menu"
                onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ at: { x: box.left, y: box.bottom + 4 }, result }); }}>⋯</button>
            </li>)}
          </ul>
        </> : <p className="ga-hint">{c.none}</p> : null}
      </fieldset>
    </> : null}

    <div><GaButton variant="danger" icon={<Trash2 size={16} />} disabled={busy} onClick={() => void uninstall()}>{c.uninstall}</GaButton></div>
    {error ? <p className="ga-settings-error" role="alert">{error}</p> : null}

    {menu ? <RowMenu at={menu.at} title={menu.result.title} onClose={() => setMenu(null)} actions={[
      { label: c.download, icon: <Download size={16} />, tone: "accent", onClick: () => void startDownload(menu.result) },
      { label: c.copyLink, icon: <Copy size={16} />, onClick: () => void navigator.clipboard?.writeText(menu.result.url).then(() => showNotice({ title: c.copied, tone: "ok" })) },
    ]} /> : null}
    {download ? <ManualLinkDialog url={download.url} query={download.query} onClose={() => setDownload(null)} /> : null}
  </section>;
}

const text = (failure: unknown) => String(failure instanceof Error ? failure.message : failure);
/** A feed's address shown by its file name ("…/sources/steamrip.json" → "steamrip"). */
const sourceName = (source: string) => source.split(/[\\/]/).pop()?.replace(/\.json$/i, "") || source;
