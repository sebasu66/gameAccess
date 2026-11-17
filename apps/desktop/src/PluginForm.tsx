import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileJson, FolderTree, Plus, Search, X } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { showNotice } from "./notice/notice";
import { formatBytes } from "./GenericDownloadProgress";
import { pluginFiles, pluginLink, pluginList, pluginListAdd, pluginListAddFile, pluginListRemove, pluginSearch,
  type PluginFiles, type PluginListData, type PluginListSection, type PluginResult, type PluginSearchSection, type PluginUi } from "./catalog/PluginManage";
import "./plugin-files.css";
import type { PluginStatus } from "./catalog/PluginRuntime";
import ManualLinkDialog from "./library-manager/ManualLinkDialog";
import { RowMenu } from "./library-manager/RowExpand";

/** A game's name from a download's title ("Cyberpunk 2077 v2.1 [SteamRIP]" → "Cyberpunk 2077"), to look it up in the catalog. */
export const titleQuery = (title: string) => title.replace(/[[(].*?[\])]/g, " ").replace(/\b(?:v|build|update)\s*\d[\w.]*.*$/i, " ").replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
const text = (failure: unknown) => String(failure instanceof Error ? failure.message : failure);

function ListSection({ plugin, section }: { plugin: PluginStatus; section: PluginListSection }) {
  const { t } = useI18n();
  const [data, setData] = useState<PluginListData | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    void pluginList(plugin, section).then(found => { if (live) setData(found); }).catch(failure => { if (live) setError(text(failure)); });
    return () => { live = false; };
  }, [plugin.id, plugin.endpoint, section.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (work: () => Promise<PluginListData>) => {
    setBusy(true); setError("");
    try { setData(await work()); return true; } catch (failure) { setError(text(failure)); return false; } finally { setBusy(false); }
  };
  const allowed = (() => { try { return !section.add?.pattern || new RegExp(section.add.pattern, "i").test(value.trim()); } catch { return true; } })();
  const load = async (chosen?: File) => { if (chosen) { const content = await chosen.text(); await run(() => pluginListAddFile(plugin, section, chosen.name, content)); } };
  const removeLabel = section.removeLabel ?? t("pluginRemove");
  return <fieldset className="ga-group ga-settings-group">
    <legend className="ga-label">{section.title}</legend>
    {section.hint ? <p className="ga-hint">{section.hint}</p> : null}
    {data?.summary ? <p className="ga-hint">{data.summary}</p> : null}
    {data?.busy && data.busyText ? <p className="ga-status" role="status">{data.busyText}</p> : null}
    <ul className="ga-plugin-feeds">
      {(data?.items ?? []).map(item => <li key={item}>
        <code title={item}>{item}</code>
        <button type="button" className="ga-plugin-icon" aria-label={`${removeLabel}: ${item}`} title={removeLabel} disabled={busy}
          onClick={() => void run(() => pluginListRemove(plugin, section, item))}><X size={16} aria-hidden="true" /></button>
      </li>)}
    </ul>
    {section.add || section.addFile ? <form className="ga-plugin-row" onSubmit={event => { event.preventDefault(); void run(() => pluginListAdd(plugin, section, value.trim())).then(ok => { if (ok) setValue(""); }); }}>
      {section.add ? <>
        <input aria-label={section.add.placeholder} placeholder={section.add.placeholder} value={value} disabled={busy} spellCheck={false} onChange={event => setValue(event.target.value)} />
        <GaButton type="submit" icon={<Plus size={16} />} disabled={busy || !value.trim() || !allowed}>{section.add.label}</GaButton>
      </> : null}
      {section.addFile ? <>
        <GaButton icon={<FileJson size={16} />} disabled={busy} onClick={() => file.current?.click()}>{section.addFile.label}</GaButton>
        <input ref={file} type="file" accept={section.addFile.accept} hidden onChange={event => { void load(event.target.files?.[0]); event.target.value = ""; }} />
      </> : null}
    </form> : null}
    {error ? <p className="ga-settings-error" role="alert">{error}</p> : null}
  </fieldset>;
}

/** What is inside a result (a torrent's files), read by the plugin before anything is downloaded. */
function ResultFiles({ title, data, error, onClose }: { title: string; data?: PluginFiles; error?: string; onClose: () => void }) {
  const { t } = useI18n();
  const root = data?.name && data.files.length > 1 ? `${data.name}/` : "";
  return <section className="ga-plugin-files" aria-label={`${t("pluginFilesHeading")}: ${title}`} aria-busy={!data && !error}>
    <div className="ga-plugin-files-head">
      <p className="ga-label">{t("pluginFilesHeading")}</p>
      <button type="button" className="ga-plugin-icon" aria-label={t("pluginFilesClose")} title={t("pluginFilesClose")} onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </div>
    <p className="ga-plugin-files-title" title={title}>{data?.name || title}</p>
    {error ? <p className="ga-settings-error" role="alert">{error}</p>
      : !data ? <p className="ga-status" role="status">{t("pluginFilesReading")}</p>
      : <>
        <p className="ga-hint">{data.files.length === 1 ? t("pluginFilesSummaryOne", { size: formatBytes(data.total) }) : t("pluginFilesSummary", { count: data.files.length, size: formatBytes(data.total) })}</p>
        <ul className="ga-plugin-files-list">
          {data.files.map(file => <li key={file.path}>
            <span className="ga-plugin-file-path" title={file.path}>{root && file.path.startsWith(root) ? file.path.slice(root.length) : file.path}</span>
            <span className="ga-plugin-file-size">{formatBytes(file.size)}</span>
          </li>)}
        </ul>
      </>}
  </section>;
}

function SearchSection({ plugin, section }: { plugin: PluginStatus; section: PluginSearchSection }) {
  const { locale, t } = useI18n();
  const [files, setFiles] = useState<{ link: string; title: string; data?: PluginFiles; error?: string } | null>(null);
  const asked = useRef("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PluginResult[] | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; result: PluginResult } | null>(null);
  const [download, setDownload] = useState<{ url: string; query: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (failure) { setError(text(failure)); } finally { setBusy(false); }
  };
  const search = () => query.trim() && run(async () => { closeFiles(); setResults(await pluginSearch(plugin, section, query.trim())); });
  const start = (result: PluginResult) => run(async () => { setDownload({ url: await pluginLink(plugin, section, result.link), query: titleQuery(result.title) }); });
  // A magnet can take a while (the plugin asks its peers): an answer for a result no longer shown is dropped.
  const showFiles = (result: PluginResult) => {
    asked.current = result.link;
    setFiles({ link: result.link, title: result.title });
    void pluginFiles(plugin, section, result.link, locale)
      .then(data => { if (asked.current === result.link) setFiles({ link: result.link, title: result.title, data }); })
      .catch(failure => { if (asked.current === result.link) setFiles({ link: result.link, title: result.title, error: text(failure) }); });
  };
  const closeFiles = () => { asked.current = ""; setFiles(null); };
  return <fieldset className="ga-group ga-settings-group">
    <legend className="ga-label">{section.title}</legend>
    <form className="ga-plugin-row" role="search" onSubmit={event => { event.preventDefault(); void search(); }}>
      <input aria-label={section.title} placeholder={section.placeholder} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} />
      <GaButton type="submit" variant="primary" icon={<Search size={16} />} disabled={busy || !query.trim()}>{section.button}</GaButton>
    </form>
    {results ? results.length ? <>
      <p className="ga-hint">{section.hint ?? t("pluginResultsHint")}</p>
      <ul className="ga-plugin-results">
        {results.map(result => <li key={result.link + result.title} onContextMenu={event => { event.preventDefault(); setMenu({ at: { x: event.clientX, y: event.clientY }, result }); }}>
          <span className="ga-plugin-result-title" title={result.title}>{result.title}</span>
          {result.meta ? <span className="ga-plugin-result-meta">{result.meta}</span> : null}
          <button type="button" className="ga-plugin-icon" aria-label={`${t("pluginActions")}: ${result.title}`} title={t("pluginActions")} aria-haspopup="menu"
            onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ at: { x: box.left, y: box.bottom + 4 }, result }); }}>⋯</button>
        </li>)}
      </ul>
    </> : <p className="ga-hint">{section.empty ?? t("pluginNoResults")}</p> : null}
    {files ? <ResultFiles title={files.title} data={files.data} error={files.error} onClose={closeFiles} /> : null}
    {error ? <p className="ga-settings-error" role="alert">{error}</p> : null}
    {menu ? <RowMenu at={menu.at} title={menu.result.title} onClose={() => setMenu(null)} actions={[
      { label: t("pluginDownload"), icon: <Download size={16} />, tone: "accent", onClick: () => void start(menu.result) },
      ...(section.filesPath && menu.result.files ? [{ label: t("pluginFiles"), icon: <FolderTree size={16} />, onClick: () => showFiles(menu.result) }] : []),
      { label: t("pluginCopyLink"), icon: <Copy size={16} />, onClick: () => void navigator.clipboard?.writeText(menu.result.link).then(() => showNotice({ title: t("pluginLinkCopied"), tone: "ok" })) },
    ]} /> : null}
    {download ? <ManualLinkDialog url={download.url} query={download.query} onClose={() => setDownload(null)} /> : null}
  </fieldset>;
}

/** The form a plugin shares (catalog/PluginManage.ts), drawn with the app's own controls. */
export default function PluginForm({ plugin, ui }: { plugin: PluginStatus; ui: PluginUi }) {
  return <>{ui.sections.map(section => section.type === "list"
    ? <ListSection key={section.id} plugin={plugin} section={section} />
    : <SearchSection key={section.id} plugin={plugin} section={section} />)}</>;
}
