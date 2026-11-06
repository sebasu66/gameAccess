import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { confirmNotice, showNotice } from "./notice/notice";
import { getPluginStatuses, pollPluginRuntime, subscribePluginStatuses, type PluginStatus } from "./catalog/PluginRuntime";
import { unregisterPluginSources } from "./catalog/PluginSources";
import { pluginUi, setPluginEnabled, uninstallPlugin, type PluginUi } from "./catalog/PluginManage";
import PluginForm from "./PluginForm";
import "./library-manager/manager.css";
import "./plugin-settings.css";

const text = (failure: unknown) => String(failure instanceof Error ? failure.message : failure);
const webAddress = (address?: string | null) => (address && /^https:\/\//i.test(address) ? address : "");

/** One plugin in Settings › Plugins: its name, state, where it comes from, what it does (in its own words), its on/off,
 *  the form it shares (PluginForm.tsx) and uninstalling it. */
export function PluginSection({ plugin, focused }: { plugin: PluginStatus; focused: boolean }) {
  const { locale, t } = useI18n();
  const [ui, setUi] = useState<PluginUi | null>(null);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const host = useRef<HTMLElement>(null);
  const on = plugin.enabled !== false;
  // Only the settings content scrolls: scrollIntoView would also move the screen around it. Settings may still be
  // opening, with nothing to scroll yet, so it goes again once the screen has settled.
  useEffect(() => {
    if (!focused) return;
    const scroll = () => {
      const scroller = host.current?.closest<HTMLElement>(".ga-settings-content");
      if (scroller && host.current) scroller.scrollTo?.({ top: host.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop, behavior: "smooth" });
    };
    scroll();
    const again = window.setTimeout(scroll, 700);
    return () => window.clearTimeout(again);
  }, [focused]);
  useEffect(() => {
    let live = true;
    setUi(null); setAsked(false);
    if (!plugin.alive) return;
    void pluginUi(plugin, locale).then(found => { if (live) { setUi(found); setAsked(true); } });
    return () => { live = false; };
  }, [plugin.id, plugin.endpoint, plugin.alive, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (failure) { setError(text(failure)); } finally { setBusy(false); }
  };
  const toggle = (next: boolean) => run(async () => {
    await setPluginEnabled(plugin.id, next);
    // Off, the catalog stops showing its downloads; on, they come back with its next sync.
    if (!next) await unregisterPluginSources(plugin.id);
    await pollPluginRuntime();
  });
  const uninstall = async () => {
    if (!await confirmNotice({ title: t("pluginUninstallTitle", { name: plugin.name }), text: t("pluginUninstallText"), confirmLabel: t("pluginUninstall"), cancelLabel: t("noticeCancel"), kind: "danger" })) return;
    await run(async () => {
      await uninstallPlugin(plugin.id);
      await unregisterPluginSources(plugin.id);
      await pollPluginRuntime();
      showNotice({ title: t("pluginUninstalled", { name: plugin.name }), tone: "ok" });
    });
  };
  const description = ui?.description || plugin.description;
  const homepage = webAddress(ui?.homepage) || webAddress(plugin.homepage);
  return <section ref={host} className="ga-plugin-settings ga-stack" data-plugin={plugin.id}>
    <div className="ga-plugin-head">
      <h3 className="ga-heading ga-plugin-title">{plugin.name}</h3>
      <label className="ga-style-toggle ga-plugin-switch"><input type="checkbox" tabIndex={-1} checked={on} disabled={busy} onChange={event => void toggle(event.target.checked)} />{t("pluginOn")}</label>
    </div>
    <p className="ga-hint">
      <span className={plugin.alive ? "ga-plugin-state is-on" : on ? "ga-plugin-state" : "ga-plugin-state is-off"}>{t(plugin.alive ? "pluginStateConnected" : on ? "pluginStateDisconnected" : "pluginStateOff")}</span>
      {" · "}{t("pluginAddress")}: <code>{plugin.endpoint}</code>
    </p>
    {description ? <p className="ga-hint">{description}</p> : null}
    {homepage ? <p className="ga-hint">{t("pluginSource")}: <a className="ga-plugin-link" href={homepage} target="_blank" rel="noopener noreferrer">{homepage}<ExternalLink size={13} aria-hidden="true" /></a></p> : null}
    {on && !plugin.alive ? <p className="ga-hint">{t("pluginOfflineHint")}</p> : asked && !ui ? <p className="ga-hint">{t("pluginNoForm")}</p> : null}
    {ui ? <PluginForm plugin={plugin} ui={ui} /> : null}
    <div><GaButton variant="danger" icon={<Trash2 size={16} />} disabled={busy} onClick={() => void uninstall()}>{t("pluginUninstall")}</GaButton></div>
    {error ? <p className="ga-settings-error" role="alert">{error}</p> : null}
  </section>;
}

/** Settings › Plugins: one section per installed plugin. */
export default function PluginSettings({ focus }: { focus?: string | null }) {
  const { t } = useI18n();
  const plugins = useSyncExternalStore(subscribePluginStatuses, getPluginStatuses, getPluginStatuses);
  if (!plugins.length) return <p className="ga-hint">{t("pluginNone")}</p>;
  return <div className="ga-plugin-list">{plugins.map(plugin => <PluginSection key={plugin.id} plugin={plugin} focused={focus === plugin.id} />)}</div>;
}
