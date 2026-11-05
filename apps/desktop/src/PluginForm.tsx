import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileJson, Plus, Search, X } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { showNotice } from "./notice/notice";
import { pluginLink, pluginList, pluginListAdd, pluginListAddFile, pluginListRemove, pluginSearch,
  type PluginListData, type PluginListSection, type PluginResult, type PluginSearchSection, type PluginUi } from "./catalog/PluginManage";
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

function SearchSection({ plugin, section }: { plugin: PluginStatus; section: PluginSearchSection }) {
  const { t } = useI18n();
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
  const search = () => query.trim() && run(async () => { setResults(await pluginSearch(plugin, section, query.trim())); });
  const start = (result: PluginResult) => run(async () => { setDownload({ url: await pluginLink(plugin, section, result.link), query: titleQuery(result.title) }); });
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
    {error ? <p className="ga-settings-error" role="alert">{error}</p> : null}
    {menu ? <RowMenu at={menu.at} title={menu.result.title} onClose={() => setMenu(null)} actions={[
      { label: t("pluginDownload"), icon: <Download size={16} />, tone: "accent", onClick: () => void start(menu.result) },
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
