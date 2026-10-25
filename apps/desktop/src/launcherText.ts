/**
 * The launcher sends the texts the player reads as keys of these catalogs, ⟦key {"arg": 1}⟧, instead of Spanish words
 * (apps/launcher/game_download_manager/ui_text.py). One text can mix keys with plain parts, such as a file name or a
 * speed; each key becomes the app's language. A text with no keys (an older launcher) is shown as it came.
 */
import { translate, type TranslationKey, type TranslationParams } from "./i18n";
import type { DownloadProgressSnapshot } from "./downloadProvider";

const KEY = /⟦(\w+)(?: (\{[^⟧]*\}))?⟧/g;

export function localizeLauncherText(text: string): string;
export function localizeLauncherText(text: string | null | undefined): string | null | undefined;
export function localizeLauncherText(text: string | null | undefined): string | null | undefined {
  if (!text || !text.includes("⟦")) return text;
  return text.replace(KEY, (whole, key: string, args?: string) => {
    try {
      return translate(key as TranslationKey, args ? JSON.parse(args) as TranslationParams : undefined);
    } catch {
      return whole;
    }
  });
}

/** Every launcher text of a download row (status, error, the current step and the finished ones). */
export function localizeSnapshot(snapshot: DownloadProgressSnapshot): DownloadProgressSnapshot {
  if (![snapshot.statusText, snapshot.error, snapshot.step?.detail, ...(snapshot.steps ?? []).map(step => step.result)].some(text => text?.includes("⟦"))) return snapshot;
  return {
    ...snapshot,
    statusText: localizeLauncherText(snapshot.statusText) ?? undefined,
    error: localizeLauncherText(snapshot.error),
    step: snapshot.step ? { ...snapshot.step, detail: localizeLauncherText(snapshot.step.detail) } : snapshot.step,
    steps: snapshot.steps?.map(step => ({ ...step, result: localizeLauncherText(step.result) })),
  };
}
