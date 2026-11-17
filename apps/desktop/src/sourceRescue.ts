/**
 * "Try another source" after a failed download: the other download sources of the game are checked one by one,
 * locally (a torrent's seeds and peers, or whether a direct link answers; launcher game_download_manager/
 * source_probe.py), with the progress shown in the same download row and in the notice. The healthiest one starts
 * the download again; if none is good, the notice says there is nothing to do.
 */
import { digitalCatalogService } from "./catalog/DigitalCatalog";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { preparePluginSource, type PluginSource } from "./catalog/PluginSources";
import { translate } from "./i18n";
import { narrate } from "./narrationLog";
import { hideNotice, showNotice, updateNotice } from "./notice/notice";
import { noticeGame } from "./notice/noticeGame";
import type { CatalogGame } from "./types";

export interface SourceHealth { kind: string; reachable: boolean; seeds: number; peers: number }
export interface CheckedSource { source: PluginSource; health: SourceHealth }

/** Torrents rank by seeds, then peers; a torrent needs at least one seed. A direct link that answers counts as one seed. */
export function sourceScore(health: SourceHealth): number {
  if (!health.reachable) return 0;
  if (health.kind === "direct") return 1;
  return health.seeds > 0 ? health.seeds * 1000 + health.peers : 0;
}

export function pickBestSource(checked: CheckedSource[]): CheckedSource | null {
  let best: CheckedSource | null = null;
  for (const item of checked) if (sourceScore(item.health) > 0 && (!best || sourceScore(item.health) > sourceScore(best.health))) best = item;
  return best;
}

const searching = new Set<number>();

export async function findAnotherSource(game: CatalogGame): Promise<void> {
  const id = game.app_id ?? game.id;
  if (searching.has(id)) return;
  searching.add(id);
  const failed = digitalDownloadService.getRecord(game.id) ?? digitalDownloadService.getRecord(id);
  const failedSnapshot = digitalDownloadService.getDownloads().find(entry => entry.snapshot.gameId === id)?.snapshot ?? null;
  const card = noticeGame(game);
  const notice = showNotice({ game: card, tone: "info", title: translate("rescueTitle"), text: translate("rescueLooking"), progress: null });
  try {
    const sources = (await digitalCatalogService.getSources(game).catch(() => [] as PluginSource[]))
      // A source players learned to avoid is not tried again.
      .filter(source => source.delivery !== "browser" && !source.lesson && source.url !== failed?.downloadSource && source.title !== failed?.sourceTitle);
    const checked: CheckedSource[] = [];
    for (const [index, source] of sources.entries()) {
      const text = translate("rescueAnalyzing", { done: index + 1, total: sources.length });
      digitalDownloadService.showSourceSearch(id, text, index / sources.length);
      updateNotice(notice, { text, progress: index / sources.length });
      try {
        const prepared = await preparePluginSource(source);
        const result = await digitalProcessManager.probeSource(game, prepared.url) as unknown as { probe?: SourceHealth };
        if (result.probe) checked.push({ source, health: result.probe });
        void narrate(`Source check for '${game.name}' · ${source.sourceName}: ${JSON.stringify(result.probe ?? {})}.`, { area: "DOWNLOAD_SOURCES" });
      } catch (error) {
        void narrate(`Source check for '${game.name}' · ${source.sourceName} failed: ${String(error)}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
      }
    }
    const best = pickBestSource(checked);
    // The row goes back to the failed download so it can start again (or stay as it was).
    digitalDownloadService.endSourceSearch(id, failedSnapshot);
    if (!best) {
      showNotice({ game: card, tone: "error", title: translate("rescueNoneTitle"), text: translate("rescueNoneText"), actions: [{ label: translate("close"), kind: "secondary", run: () => hideNotice() }] });
      return;
    }
    showNotice({ game: card, tone: "ok", title: translate("rescueFoundTitle"), text: translate("rescueFoundText", { source: best.source.sourceName || best.source.title }) });
    await digitalCatalogService.download(game, best.source);
  } catch (error) {
    digitalDownloadService.endSourceSearch(id, failedSnapshot);
    showNotice({ game: card, tone: "error", title: translate("rescueNoneTitle"), text: String(error instanceof Error ? error.message : error), actions: [{ label: translate("close"), kind: "secondary", run: () => hideNotice() }] });
  } finally {
    searching.delete(id);
  }
}
