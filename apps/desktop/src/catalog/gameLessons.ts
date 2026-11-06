/**
 * What players learned about each game (server: apps/api/app/game_lessons.py; design: vault/Lo aprendido por juego.md).
 * Every lesson has a game (AppID) and a kind, open to more: `bad_source` (a download source that does not work, named
 * by its fingerprint, never its address), `how_to_run` (special requirements or steps) and `abandoned` (the game is no
 * longer valid).
 *
 * The lessons live in the local catalog database (src-tauri/src/game_lessons.rs). The server sends a snapshot and
 * then only what changed, in the same step as the catalog updates (startup, at most daily); every question the app
 * asks is answered from that copy, without waiting for the network and without a connection. A bad source the player
 * finds is stored there at once and sent to the server in the background.
 */
import { invoke } from "@tauri-apps/api/core";
import { getInstallationId } from "../activation";
import { hasTauriRuntime } from "../native";
import { narrate } from "../narrationLog";
import { getApiBaseUrl } from "../settings";
import { sourceFingerprint } from "./sourceFingerprint";

export type LessonKind = "bad_source" | "how_to_run" | "abandoned" | (string & {});
export type LessonScope = "source" | "provider" | "game";
/** Reasons the app reports for a bad source; the server's list (REPORTABLE_REASONS) can hold more. */
export type BadSourceReason = "not_a_game" | "wrong_password" | "corrupt_archive" | "malware_flagged" | "incomplete";
export interface GameLesson {
  kind: LessonKind; scope: LessonScope; subject: string; reason: string; app_id?: number | null;
  action: "avoid" | "prefer" | "note" | "discard" | (string & {}); text?: string; detail?: string[];
  reports: number; confidence: "flagged" | "confirmed" | "mine" | (string & {}); first_seen: string; last_seen: string;
}
interface LessonsPage { revision?: unknown; full?: unknown; lessons?: unknown; removed?: unknown }

let pending: Promise<void> | null = null;

function validLesson(value: unknown): value is GameLesson {
  const item = value as Partial<GameLesson> | null;
  return !!item && typeof item.kind === "string" && typeof item.subject === "string" && typeof item.reason === "string"
    && ["source", "provider", "game"].includes(String(item.scope)) && typeof item.action === "string";
}

/** Brings the local copy up to date: everything the first time, then only the changes. Never throws. */
export function syncGameLessons(fetcher: typeof fetch = fetch): Promise<void> {
  if (!hasTauriRuntime()) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    const started = Date.now();
    try {
      const [api, since] = await Promise.all([getApiBaseUrl(), invoke<number>("game_lessons_revision")]);
      if (!api) return;
      const response = await fetcher(`${api}/game-lessons?since=${since || 0}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const page = await response.json() as LessonsPage;
      const lessons = Array.isArray(page.lessons) ? page.lessons.filter(validLesson) : [];
      const removed = Array.isArray(page.removed) ? page.removed : [];
      const revision = Number(page.revision) || 0;
      if (revision === since && !lessons.length && !removed.length) return;
      const applied = await invoke<{ total: number; work_ms: number }>("game_lessons_apply", { revision, full: page.full === true, lessons, removed });
      void narrate(`Game lessons: ${page.full === true ? "snapshot" : "changes"} since ${since || 0} → revision ${revision} (+${lessons.length} / -${removed.length}); `
        + `${applied.total} kept here; saving ${applied.work_ms} ms, total ${Date.now() - started} ms.`, { area: "DOWNLOAD_SOURCES" });
    } catch (error) {
      void narrate(`Game lessons could not be synchronized; the local copy is used: ${error instanceof Error ? error.message : String(error)}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
    } finally { pending = null; }
  })();
  return pending;
}

/** Everything learned about a game, plus the bad-source lessons for these fingerprints and providers. Local only. */
export async function queryGameLessons(appId: number | null | undefined, fingerprints: string[] = [], providers: string[] = []): Promise<GameLesson[]> {
  if (!hasTauriRuntime()) return [];
  try {
    const found = await invoke<GameLesson[]>("game_lessons_query", { appId: appId ?? null, fingerprints, providers });
    return Array.isArray(found) ? found : [];
  } catch { return []; }
}

/** Whether the game is marked abandoned: it stays downloadable, but the server does not accelerate it. Local only. */
export async function gameIsAbandoned(appId: number | null | undefined): Promise<boolean> {
  if (!appId) return false;
  return (await queryGameLessons(appId)).some(lesson => lesson.kind === "abandoned" && lesson.scope === "game" && lesson.subject === String(appId));
}

/** A bad source the player found: kept here at once (it counts for them right away) and sent to the server in the
 *  background; the server never receives its address. */
export async function reportBadSource(report: { url?: string; fingerprint?: string | null; reason: BadSourceReason; appId?: number; detail?: string[] },
  fetcher: typeof fetch = fetch): Promise<void> {
  const fingerprint = report.fingerprint || (report.url ? await sourceFingerprint(report.url) : null);
  if (!fingerprint) return;
  const now = new Date().toISOString();
  const lesson: GameLesson = { kind: "bad_source", scope: "source", subject: fingerprint, reason: report.reason, app_id: report.appId ?? null,
    action: "avoid", text: "", detail: report.detail ?? [], reports: 1, confidence: "mine", first_seen: now, last_seen: now };
  if (hasTauriRuntime()) {
    try { await invoke("game_lessons_add_mine", { lesson }); } catch { /* the report still goes to the server */ }
  }
  try {
    const [api, installationId] = await Promise.all([getApiBaseUrl(), getInstallationId()]);
    if (!api || !installationId) return;
    const response = await fetcher(`${api}/game-lessons/report`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-GameAccess-Installation": installationId },
      body: JSON.stringify({ kind: "bad_source", scope: "source", subject: fingerprint, reason: report.reason, app_id: report.appId, detail: report.detail ?? [] }),
    });
    void narrate(`Bad source '${report.reason}' reported for AppID ${report.appId ?? "?"} (fingerprint ${fingerprint.slice(0, 12)}): HTTP ${response.status}.`, { area: "DOWNLOAD_SOURCES" });
  } catch (error) {
    void narrate(`Bad source could not be reported: ${error instanceof Error ? error.message : String(error)}.`, { area: "DOWNLOAD_SOURCES", level: "WARN" });
  }
}

const providerKey = (name?: string) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** The lesson that says to avoid this source (its own fingerprint first, then its provider), or undefined. */
export function avoidLesson(source: { fingerprint?: string | null; sourceName?: string }, lessons: GameLesson[]): GameLesson | undefined {
  const avoid = lessons.filter(lesson => lesson.kind === "bad_source" && lesson.action === "avoid");
  return avoid.find(lesson => lesson.scope === "source" && !!source.fingerprint && lesson.subject === source.fingerprint)
    ?? avoid.find(lesson => lesson.scope === "provider" && !!providerKey(source.sourceName) && lesson.subject === providerKey(source.sourceName));
}

/**
 * Adds each source's fingerprint and, for a source to avoid, the lesson that says so; those go to the end, in the
 * order they had. The first source is then never a marked one unless every source is.
 */
export async function applySourceLessons<T extends { url: string; sourceName?: string }>(sources: T[], appId?: number | null,
  lookup: typeof queryGameLessons = queryGameLessons): Promise<(T & { fingerprint?: string; lesson?: GameLesson })[]> {
  const withPrints = await Promise.all(sources.map(async source => ({ ...source, fingerprint: await sourceFingerprint(source.url) ?? undefined })));
  if (!withPrints.length) return withPrints;
  const lessons = await lookup(appId, withPrints.flatMap(source => source.fingerprint ? [source.fingerprint] : []),
    [...new Set(withPrints.map(source => providerKey(source.sourceName)).filter(Boolean))]);
  const marked = withPrints.map(source => { const lesson = avoidLesson(source, lessons); return lesson ? { ...source, lesson } : source; });
  return [...marked.filter(source => !("lesson" in source)), ...marked.filter(source => "lesson" in source)];
}
