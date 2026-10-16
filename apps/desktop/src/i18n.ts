import { useCallback, useSyncExternalStore } from "react";
import { es } from "./locales/es";
import { en } from "./locales/en";

export type AppLocale = "es" | "en";
export type TranslationParams = Record<string, string | number>;

const STORAGE_KEY = "gameaccess:language";
const FALLBACK_LOCALE: AppLocale = "es";
export const LOCALE_CHANGED_EVENT = "gameaccess:locale-changed";

export type TranslationKey = keyof typeof es;


const catalogs: Record<AppLocale, Record<TranslationKey, string>> = { es, en };
const listeners = new Set<() => void>();

function detectLocale(): AppLocale {
  if (typeof window === "undefined") return FALLBACK_LOCALE;
  const stored = window.localStorage?.getItem?.(STORAGE_KEY);
  if (stored === "es" || stored === "en") return stored;
  return window.navigator?.language?.toLowerCase().startsWith("en") ? "en" : FALLBACK_LOCALE;
}

let currentLocale: AppLocale = detectLocale();

function interpolate(value: string, params?: TranslationParams): string {
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(params[key] ?? ""));
}

export function getAppLocale(): AppLocale {
  return currentLocale;
}

export function getSteamStoreLanguage(): "spanish" | "english" {
  return currentLocale === "es" ? "spanish" : "english";
}

export function translate(key: TranslationKey, params?: TranslationParams, locale = currentLocale): string {
  const value = catalogs[locale]?.[key] ?? catalogs[FALLBACK_LOCALE][key] ?? key;
  return interpolate(value, params);
}

export function translateServerDetail(detail: string): string {
  const normalized = detail.trim();
  const known: Record<string, TranslationKey> = {
    "Invalid or unavailable activation key": "activationInvalidKey",
    "This activation key has expired": "activationUnusedExpired",
    "This key is already active on another installation": "activationOtherInstall",
    "This activation has expired": "activationAccessExpired",
    "GameAccess activation is required or has expired": "activationExpired",
  };
  return known[normalized] ? translate(known[normalized]) : normalized;
}

export function setAppLocale(locale: AppLocale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, locale);
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGED_EVENT, { detail: locale }));
  }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): AppLocale {
  return currentLocale;
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, snapshot, snapshot);
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(key, params, locale),
    [locale],
  );
  return {
    locale,
    localeTag: locale === "es" ? "es-AR" : "en-US",
    setLocale: setAppLocale,
    t,
  };
}

if (typeof document !== "undefined") document.documentElement.lang = currentLocale;
