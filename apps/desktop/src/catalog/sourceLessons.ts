/**
 * What players learned about download sources (server: apps/api/app/source_lessons.py). A source that turned out
 * not to be a game for one player is reported by its fingerprint (never its address); once enough players agree the
 * server publishes it, and every app moves it to the end of the list with the reason, so the Download button never
 * picks it by default. The player's own reports count at once on this PC, before the server publishes them.
 *
 * The list is small and travels with the catalog synchronization (startup and daily); it is kept in localStorage so
 * the sources are ordered right with the server out of reach. Reading it never waits for the network.
 */
import { getInstallationId } from "../activation";
import { narrate } from "../narrationLog";
import { getApiBaseUrl } from "../settings";
import { sourceFingerprint } from "./sourceFingerprint";

export type LessonScope = "source" | "provider" | "game";
/** Reasons the app reports today; the server's list (REPORTABLE_REASONS) can hold more. */
export type LessonReason = "not_a_game" | "wrong_password" | "corrupt_archive" | "malware_flagged" | "incomplete";
export interface SourceLesson {
  scope: LessonScope; subject: string; reason: string; action: "avoid" | "prefer" | "note";
  app_id?: number | null; detail?: string[]; reports: number; confidence: "flagged" | "confirmed" | "mine";
  first_seen: string; last_seen: string;
}
interface CachedLessons { revision: string; fetchedAt: number; lessons: SourceLesson[] }

const CACHE_KEY = "gameaccess:source-lessons";
const MINE_KEY = "gameaccess:source-lessons:mine";
const MAX_AGE_MS = 6 * 3600_000;
const MAX_MINE = 200;
let pending: Promise<void> | null = null;

function read<T>(key: string, fallback: T): T {
  try {
    const value = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

function validLesson(value: unknown): value is SourceLesson {
  const item = value as Partial<SourceLesson> | null;
  return !!item && typeof item.subject === "string" && typeof item.reason === "string"
    && ["source", "provider", "game"].includes(String(item.scope)) && ["avoid", "prefer", "note"].includes(String(item.action));
}

/** The published lessons plus this player's own reports. */
export function knownSourceLessons(): SourceLesson[] {
  return [...read<SourceLesson[]>(MINE_KEY, []), ...read<CachedLessons>(CACHE_KEY, { revision: "", fetchedAt: 0, lessons: [] }).lessons];
}

/** Ask the server for the published list when the copy here is older than 6 hours (or `force`). Never throws. */
export function refreshSourceLessons(force = false, fetcher: typeof fetch = fetch): Promise<void> {
  const cached = read<CachedLessons>(CACHE_KEY, { revision: "", fetchedAt: 0, lessons: [] });
  if (!force && Date.now() - cached.fetchedAt < MAX_AGE_MS) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    try {
      const api = await getApiBaseUrl();
      if (!api) return;
      const query = cached.revision ? `?since=${encodeURIComponent(cached.revision)}` : "";
      const response = await fetcher(`${api}/source-lessons${query}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { revision?: unknown; unchanged?: unknown; lessons?: unknown };
      const revision = typeof body.revision === "string" ? body.revision : "";
      const lessons = body.unchanged === true ? cached.lessons : Array.isArray(body.lessons) ? body.lessons.filter(validLesson) : [];
      write(CACHE_KEY, { revision, fetchedAt: Date.now(), lessons } satisfies CachedLessons);
      if (body.unchanged !== true) void narrate(`Source lessons: ${lessons.length} published (revision ${revision}).`, { area: "DOWNLOAD_SOURCES" });
    } catch (error) {
      void narrate(`Source lessons could not be refreshed: ${error instanceof Error ? error.message : String(error)}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
    } finally { pending = null; }
  })();
  return pending;
}

/** Tell the server (and remember here) that a source was bad. Best effort: a failed send is not retried. */
export async function reportSourceLesson(report: { url?: string; fingerprint?: string | null; reason: LessonReason; appId?: number; detail?: string[] },
  fetcher: typeof fetch = fetch): Promise<void> {
  const fingerprint = report.fingerprint || (report.url ? await sourceFingerprint(report.url) : null);
  if (!fingerprint) return;
  const now = new Date().toISOString();
  const mine = read<SourceLesson[]>(MINE_KEY, []).filter(item => !(item.subject === fingerprint && item.reason === report.reason));
  mine.unshift({ scope: "source", subject: fingerprint, reason: report.reason, action: "avoid", app_id: report.appId ?? null,
    detail: report.detail ?? [], reports: 1, confidence: "mine", first_seen: now, last_seen: now });
  write(MINE_KEY, mine.slice(0, MAX_MINE));
  try {
    const [api, installationId] = await Promise.all([getApiBaseUrl(), getInstallationId()]);
    if (!api || !installationId) return;
    const response = await fetcher(`${api}/source-lessons/report`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-GameAccess-Installation": installationId },
      body: JSON.stringify({ scope: "source", subject: fingerprint, reason: report.reason, app_id: report.appId, detail: report.detail ?? [] }),
    });
    void narrate(`Source lesson '${report.reason}' reported for AppID ${report.appId ?? "?"} (fingerprint ${fingerprint.slice(0, 12)}): HTTP ${response.status}.`, { area: "DOWNLOAD_SOURCES" });
  } catch (error) {
    void narrate(`Source lesson could not be reported: ${error instanceof Error ? error.message : String(error)}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
  }
}

/** The lesson that says to avoid this source (its own fingerprint first, then its provider), or undefined. */
export function avoidLesson(source: { fingerprint?: string | null; sourceName?: string }, lessons: SourceLesson[]): SourceLesson | undefined {
  const provider = (source.sourceName ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const avoid = lessons.filter(lesson => lesson.action === "avoid");
  return avoid.find(lesson => lesson.scope === "source" && !!source.fingerprint && lesson.subject === source.fingerprint)
    ?? avoid.find(lesson => lesson.scope === "provider" && !!provider && lesson.subject === provider);
}

/**
 * Adds each source's fingerprint and, for a source to avoid, the lesson that says so; those go to the end, in the
 * order they had. The first source is then never a marked one unless every source is.
 */
export async function applySourceLessons<T extends { url: string; sourceName?: string }>(sources: T[],
  lessons: SourceLesson[] = knownSourceLessons()): Promise<(T & { fingerprint?: string; lesson?: SourceLesson })[]> {
  const marked = await Promise.all(sources.map(async source => {
    const fingerprint = await sourceFingerprint(source.url) ?? undefined;
    const lesson = avoidLesson({ fingerprint, sourceName: source.sourceName }, lessons);
    return { ...source, fingerprint, ...(lesson ? { lesson } : {}) };
  }));
  return [...marked.filter(source => !source.lesson), ...marked.filter(source => source.lesson)];
}
