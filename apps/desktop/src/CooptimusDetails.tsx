import { useEffect, useState } from "react";
import { getApiBaseUrl } from "./settings";
import { useI18n } from "./i18n";
import { narrate } from "./narrationLog";
type CoopDetails = { app_id: number; state: string; local_players_max?: number; online_players_max?: number; source_url?: string; stale?: boolean };
const cache = new Map<number, {at: number; value: CoopDetails}>();
const pending = new Map<number, Promise<CoopDetails | null>>();
export async function loadCooptimusDetails(appId: number): Promise<CoopDetails | null> {
  const previous = cache.get(appId);
  if (previous && Date.now() - previous.at < (previous.value.state === "ready" ? 86400000 : 3600000)) return previous.value;
  const running = pending.get(appId);
  if (running) return running;
  const request = (async () => {
    const api = await getApiBaseUrl();
    if (!api) return null;
    const response = await fetch(`${api}/library/games/${appId}/cooptimus`, {signal: AbortSignal.timeout(6000)});
    if (!response.ok) return null;
    const value = await response.json() as CoopDetails;
    if (value.app_id !== appId) return null;
    cache.set(appId, {at: Date.now(), value});
    void narrate(`Co-Optimus game details: app_id=${appId}, state=${value.state}.`, {area:"CATALOG"});
    return value;
  })().catch(() => null).finally(() => pending.delete(appId));
  pending.set(appId, request);
  return request;
}
export default function CooptimusDetails({appId, enabled = true}: {appId: number | null; enabled?: boolean}) {
  const {locale} = useI18n();
  const en = locale === "en";
  const [data, setData] = useState<CoopDetails | null>(null);
  useEffect(() => {
    setData(null);
    if (!enabled || !appId) return;
    let active = true;
    void loadCooptimusDetails(appId).then(value => { if (active) setData(value); });
    return () => {active = false;};
  }, [appId, enabled]);
  if (!enabled || !appId) return null;
  return <details className="ga-detail-coop">
    <summary>{en ? "Co-op details" : "Detalles cooperativos"} · Co-Optimus</summary>
    {data?.state === "ready" ? <p>
      {data.local_players_max != null ? <span>{en ? "Local players" : "Jugadores locales"}: {data.local_players_max} </span> : null}
      {data.online_players_max != null ? <span>{en ? "Online players" : "Jugadores en línea"}: {data.online_players_max}</span> : null}
    </p> : <p>{en ? "Verified player details are currently unavailable." : "Los datos verificados de jugadores no están disponibles por ahora."}</p>}
    <a href={`https://www.co-optimus.com/games.php?search=true&steam=${appId}`} target="_blank" rel="noreferrer">{en ? "View Co-Optimus" : "Ver Co-Optimus"}</a>
  </details>;
}
