/**
 * The "Activar premium" screen is described by data downloaded from the server,
 * so its text, prices and ways to pay can change without shipping a new client.
 *
 * The client only draws that data with its own components. It never runs code or
 * HTML from the server, and it only opens links whose host is on the allow-list.
 */
import { getApiBaseUrl, boundedFetch } from "./settings";

export const PREMIUM_ACTIVATED_EVENT = "gameaccess:premium-activated";

export type Lang = "es" | "en";
export type Text = Record<Lang, string>;
export interface PremiumMethod { label: Text; note?: Text; url: string }
export interface PremiumPlan { id: string; name: Text; price: Text; perks: Record<Lang, string[]> }
export interface PremiumContent {
  version: 1;
  title: Text;
  intro: Text;
  plans: PremiumPlan[];
  /** Ways to pay by region code ("AR", ...). "default" is used for every other place. */
  regions: Record<string, { label: Text; methods: PremiumMethod[] }>;
  /** Region the server guessed for this person. */
  region: string;
}
export type PremiumSource = "server" | "cache" | "default";

const websiteUrl = import.meta.env.VITE_GAMEACCESS_WEBSITE_URL?.trim() || "https://gameaccess.app";
const CACHE_KEY = "gameaccess:premium-content";

/** Hosts a payment or information link may point to. */
export const ALLOWED_LINK_HOSTS = [
  "patreon.com", "www.patreon.com", "mpago.la", "mercadopago.com.ar", "www.mercadopago.com.ar",
  "gameaccess.app", "www.gameaccess.app",
];

export function isAllowedLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    const own = new URL(websiteUrl).hostname;
    return url.protocol === "https:" && !url.username && !url.password
      && (ALLOWED_LINK_HOSTS.includes(url.hostname) || url.hostname === own);
  } catch { return false; }
}

const text = (value: unknown, max = 400): Text | null => {
  if (!value || typeof value !== "object") return null;
  const { es, en } = value as Record<string, unknown>;
  if (typeof es !== "string" || typeof en !== "string") return null;
  if (es.length > max || en.length > max) return null;
  return { es, en };
};

/** Accept only the exact shape we draw; anything else is rejected whole. */
export function parsePremiumContent(raw: unknown): PremiumContent | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) return null;
  const title = text(value.title, 120);
  const intro = text(value.intro, 600);
  if (!title || !intro || !Array.isArray(value.plans) || !value.regions || typeof value.regions !== "object") return null;
  const plans: PremiumPlan[] = [];
  for (const entry of value.plans.slice(0, 6)) {
    const plan = entry as Record<string, unknown>;
    const name = text(plan?.name, 80);
    const price = text(plan?.price, 80);
    const perks = plan?.perks as Record<string, unknown> | undefined;
    if (typeof plan?.id !== "string" || !name || !price || !perks) return null;
    if (!Array.isArray(perks.es) || !Array.isArray(perks.en)) return null;
    const es = perks.es.filter((item): item is string => typeof item === "string" && item.length <= 200).slice(0, 8);
    const en = perks.en.filter((item): item is string => typeof item === "string" && item.length <= 200).slice(0, 8);
    plans.push({ id: plan.id.slice(0, 40), name, price, perks: { es, en } });
  }
  const regions: PremiumContent["regions"] = {};
  for (const [code, entry] of Object.entries(value.regions as Record<string, unknown>).slice(0, 12)) {
    const region = entry as Record<string, unknown>;
    const label = text(region?.label, 60);
    if (!label || !Array.isArray(region.methods)) continue;
    const methods: PremiumMethod[] = [];
    for (const item of region.methods.slice(0, 6)) {
      const method = item as Record<string, unknown>;
      const methodLabel = text(method?.label, 80);
      if (!methodLabel || !isAllowedLink(method.url)) continue;
      const note = method.note === undefined ? undefined : text(method.note, 300) ?? undefined;
      methods.push({ label: methodLabel, note, url: method.url });
    }
    regions[code.slice(0, 16)] = { label, methods };
  }
  if (!regions.default) return null;
  const region = typeof value.region === "string" && regions[value.region] ? value.region : "default";
  return { version: 1, title, intro, plans, regions, region };
}

/** Used when the server cannot be reached and nothing was saved before. */
export const DEFAULT_PREMIUM_CONTENT: PremiumContent = {
  version: 1,
  title: { es: "Activar premium", en: "Activate premium" },
  intro: {
    es: "Con premium la app procesa las descargas por vos y las acelera. Conseguí tu llave en la web.",
    en: "With premium the app processes downloads for you and speeds them up. Get your key on the website.",
  },
  plans: [],
  regions: {
    default: { label: { es: "Otros países", en: "Other countries" },
      methods: [{ label: { es: "Ver cómo conseguir una llave", en: "See how to get a key" }, url: websiteUrl }] },
  },
  region: "default",
};

/** Time zone and language give a first guess of the region; the server may improve it. */
export function regionHint(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (zone.startsWith("America/Argentina") || zone === "America/Buenos_Aires") return "AR";
    if (/-AR$/i.test(navigator.language || "")) return "AR";
  } catch { /* A hint only. */ }
  return "";
}

export function methodsFor(content: PremiumContent, region: string) {
  return (content.regions[region] ?? content.regions.default).methods;
}

function readCache(): PremiumContent | null {
  try { return parsePremiumContent(JSON.parse(localStorage.getItem(CACHE_KEY) || "null")); }
  catch { return null; }
}

/** Download the screen's data. Falls back to the last copy saved, then to a minimal built-in one. */
export async function fetchPremiumContent(signal?: AbortSignal): Promise<{ content: PremiumContent; source: PremiumSource }> {
  try {
    const base = await getApiBaseUrl();
    if (base) {
      const hint = regionHint();
      const response = await boundedFetch(fetch, signal)(`${base}/premium/content${hint ? `?hint=${hint}` : ""}`, { cache: "no-store" });
      if (response.ok) {
        const raw = await response.json();
        const content = parsePremiumContent(raw);
        if (content) {
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(raw)); } catch { /* Optional cache. */ }
          return { content, source: "server" };
        }
      }
    }
  } catch { /* Offline or server asleep: use what we have. */ }
  const cached = readCache();
  return cached ? { content: cached, source: "cache" } : { content: DEFAULT_PREMIUM_CONTENT, source: "default" };
}
