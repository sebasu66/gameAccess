import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAiConnected } from "./aiConnection";
import { usePersonalOrder } from "./personalOrder";
import { queryCatalogCache, type CatalogQueryParams } from "./catalogCache";
import { getAppLocale } from "./i18n";
import { libraryMembership, useLibraryGames } from "./libraryMembership";
import { readPlayHistory } from "./recentGames";
import { loadTasteNames, rememberTasteNames, type Ratings } from "./tasteProfile";
import type { CatalogGame } from "./types";
import { uiDemo } from "./devDemo/uiDemo";

/**
 * AI suggestions (Seba, 2026-11-04; vault/IA en la app.md). Gemma (through the player's Ollama key, ai_chat_json)
 * never reads the catalog: it gets what the player told us, and only that, and answers in a fixed JSON shape.
 * - Signals: liked and disliked games (the thumbs, by name), the games in the library (a choice too) and the games
 *   played lately. From MIN_SIGNALS of them the suggestions start.
 * - Picks: Gemma names about 20 PC games the player would like, each with a "why" that names the player's own games;
 *   each name is looked up in the catalog (parental policy applied) and kept only when it is there and new to the
 *   player.
 * - New games: once a day a short list of recent releases goes to Gemma, which may pick up to 3 for the player.
 * - Search (Seba, 2026-11-04): with the magic button on, the player writes what they want in their own words; Gemma
 *   answers with games (name and Steam id) the player does not have. On the detail of a game she suggested, she
 *   explains why (aiExplain), in a glass panel.
 * Every answer is checked against what really exists; anything else is dropped. Results are kept (localStorage) so
 * the same question is not asked twice; the "why" of each game is kept for its detail page.
 */

export const AI_SUGGESTIONS_EVENT = "gameaccess:ai-suggestions";
export const MIN_SIGNALS = 5;
const PICKS_KEY = "gameaccess:ai-picks";
const WHY_KEY = "gameaccess:ai-why";
const PICKS_TTL = 24 * 3600_000;
const FRESH_TTL = 24 * 3600_000;
const QUERY_TTL = 7 * 24 * 3600_000;
const LIST_LIMIT = 30;

export interface TasteSignals { liked: string[]; disliked: string[]; library: string[]; played: string[] }
export interface AiPick { game: CatalogGame; why: string }
export interface AiPicksState { at: number; signature: string; picks: AiPick[]; fresh: AiPick[]; freshAt: number }
export type AiError = "no_key" | "rejected" | "limit" | "offline" | "failed";

const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const norm = (value: string) => value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* only a cache */ } };
const unique = (values: string[]) => [...new Map(values.filter(Boolean).map(value => [norm(value), value.trim()])).values()];

/** What the player told us: the thumbs (by name), the library and what they played lately, newest first. */
export function tasteSignals(ratings: Ratings, names: Record<number, string> = loadTasteNames(), library: CatalogGame[] = libraryMembership.getGames(), history: Record<number, number> = readPlayHistory()): TasteSignals {
  const byId = new Map(library.map(game => [game.app_id ?? game.id, game.name]));
  const rated = (value: 1 | -1) => Object.entries(ratings).filter(([, rating]) => rating === value).map(([id]) => names[Number(id)]).filter(Boolean);
  const played = Object.entries(history).sort((a, b) => b[1] - a[1]).map(([id]) => byId.get(Number(id)) ?? names[Number(id)]).filter((name): name is string => Boolean(name));
  return {
    liked: unique(rated(1)).slice(0, LIST_LIMIT),
    disliked: unique(rated(-1)).slice(0, LIST_LIMIT),
    library: unique(library.map(game => game.name)).slice(0, LIST_LIMIT),
    played: unique(played).slice(0, 12),
  };
}

export const signalCount = (signals: TasteSignals) => signals.liked.length + signals.disliked.length + signals.library.length;
/** Enough to suggest: MIN_SIGNALS choices, at least one of them a like or a library game. */
export const enoughSignals = (signals: TasteSignals) => signalCount(signals) >= MIN_SIGNALS && signals.liked.length + signals.library.length > 0;
export const signalsSignature = (signals: TasteSignals) => JSON.stringify([signals.liked, signals.disliked, signals.library].map(list => list.map(norm).sort()));

const language = () => getAppLocale() === "es" ? "Spanish (Rioplatense, using vos)" : "English";
const systemPrompt = () => `You are the game recommender inside Game Access, a PC game launcher. Answer only with the JSON requested. Write every "why" in ${language()}: one short sentence in the second person that names one or two of the player's own games it relates to and what they share. Recommend real PC games that are on Steam. Never recommend a game the player already rated, owns or played, nor anything like the games they disliked.`;

function describe(signals: TasteSignals): string {
  const list = (title: string, games: string[]) => games.length ? `${title}: ${games.join("; ")}` : "";
  return [list("Liked", signals.liked), list("Disliked", signals.disliked), list("In their library", signals.library), list("Played lately", signals.played)].filter(Boolean).join("\n");
}

async function askGemma<T>(prompt: string, schema: object): Promise<T> {
  return invoke<T>("ai_chat_json", { system: systemPrompt(), prompt, schema });
}

export function aiError(error: unknown): AiError {
  const text = String(error);
  return text === "no_key" || text === "rejected" || text === "limit" || text === "offline" ? text : "failed";
}

const PICKS_SCHEMA = { type: "object", properties: { games: { type: "array", maxItems: 20, items: { type: "object", properties: { name: { type: "string" }, steam_app_id: { type: "integer" }, year: { type: "integer" }, why: { type: "string" } }, required: ["name", "why"] } } }, required: ["games"] };

/** The catalog game a suggested name stands for: the same name, else the closest one that starts with it. */
export function matchSuggested(name: string, found: CatalogGame[]): CatalogGame | null {
  const wanted = norm(name);
  if (!wanted) return null;
  return found.find(game => norm(game.name) === wanted)
    ?? found.find(game => norm(game.name).startsWith(`${wanted} `) || wanted.startsWith(`${norm(game.name)} `))
    ?? null;
}

const cleanWhy = (why: unknown) => typeof why === "string" ? why.replace(/\s+/g, " ").trim().slice(0, 240) : "";

/** Looks each suggested name up in the catalog; keeps the ones that are there and new to the player. */
export async function resolveSuggestions(answer: unknown, signals: TasteSignals, query: (params: CatalogQueryParams) => Promise<{ items: CatalogGame[] }> = queryCatalogCache): Promise<AiPick[]> {
  const games = Array.isArray((answer as { games?: unknown })?.games) ? (answer as { games: Array<{ name?: unknown; steam_app_id?: unknown; why?: unknown }> }).games : [];
  const known = new Set([...signals.liked, ...signals.disliked, ...signals.library, ...signals.played].map(norm));
  const picks: AiPick[] = [];
  const seen = new Set<number>();
  for (const item of games.slice(0, 20)) {
    if (typeof item?.name !== "string" || known.has(norm(item.name))) continue;
    const why = cleanWhy(item.why);
    if (!why) continue;
    // The Steam id Gemma gives comes from memory (it does not browse) and is often wrong: it is used only when the
    // catalog game with that id has the same name; otherwise the game is looked up by its name.
    const byId = typeof item.steam_app_id === "number" && item.steam_app_id > 0
      ? await query({ app_ids: [item.steam_app_id], limit: 1 }).catch(() => ({ items: [] as CatalogGame[] }))
      : { items: [] as CatalogGame[] };
    const found = matchSuggested(item.name, byId.items) ? byId
      : await query({ query: item.name, limit: 8, sort_by: "steam-popularity", sort_direction: "desc" }).catch(() => ({ items: [] as CatalogGame[] }));
    const game = matchSuggested(item.name, found.items);
    if (!game || seen.has(game.id) || known.has(norm(game.name))) continue;
    seen.add(game.id);
    picks.push({ game, why });
  }
  return picks;
}

export function readPicks(): AiPicksState | null {
  const state = read<AiPicksState | null>(PICKS_KEY, null);
  return state && Array.isArray(state.picks) ? { ...state, fresh: Array.isArray(state.fresh) ? state.fresh : [] } : null;
}

function savePicks(state: AiPicksState) {
  write(PICKS_KEY, state);
  const why = read<Record<number, { why: string; at: number }>>(WHY_KEY, {});
  for (const pick of [...state.picks, ...state.fresh]) why[pick.game.id] = { why: pick.why, at: Date.now() };
  write(WHY_KEY, why);
  window.dispatchEvent(new Event(AI_SUGGESTIONS_EVENT));
}

/** Why the AI thinks the player would like this game, when it said so (Home picks, new games, search). */
export function aiWhy(gameId: number): string | null {
  return read<Record<number, { why: string }>>(WHY_KEY, {})[gameId]?.why ?? null;
}

const EXPLAIN_SCHEMA = { type: "object", properties: { explanation: { type: "string" } }, required: ["explanation"] };

/**
 * The longer reason for a game Gemma suggested, asked when its detail opens (once; it is kept with the short one).
 * Returns null for games she did not suggest.
 */
export async function aiExplain(game: CatalogGame, signals: TasteSignals): Promise<string | null> {
  const all = read<Record<number, { why: string; at: number; long?: string }>>(WHY_KEY, {});
  const kept = all[game.id];
  if (!kept) return null;
  if (kept.long) return kept.long;
  if (!native()) return import.meta.env.DEV && uiDemo() ? kept.why : null;
  const answer = await askGemma<{ explanation?: unknown }>(`The player's choices:
${describe(signals)}

You suggested this game to them: ${JSON.stringify({ ...compact(game), short_why: kept.why })}

Explain in 2 to 4 sentences why they would enjoy it: name the player's games it is like and what they share, and say honestly what might not suit them.`, EXPLAIN_SCHEMA);
  const long = typeof answer?.explanation === "string" ? answer.explanation.replace(/\s+/g, " ").trim().slice(0, 900) : "";
  if (!long) return kept.why;
  write(WHY_KEY, { ...read<Record<number, unknown>>(WHY_KEY, {}), [game.id]: { ...kept, long } });
  return long;
}

let running: Promise<AiPicksState | null> | null = null;

/**
 * The suggestions for Home: asked again when the player's choices changed (and the last answer is over 10 minutes
 * old) or once a day. Returns the kept ones otherwise.
 */
export function refreshPicks(signals: TasteSignals, options: { force?: boolean } = {}): Promise<AiPicksState | null> {
  if (running) return running;
  const kept = readPicks();
  const signature = signalsSignature(signals);
  if (!enoughSignals(signals)) return Promise.resolve(kept);
  const stale = !kept || Date.now() - kept.at > PICKS_TTL || (kept.signature !== signature && Date.now() - kept.at > 10 * 60_000);
  if (!options.force && !stale) return Promise.resolve(kept);
  running = (async () => {
    if (!native()) return demoState(signature, kept);
    const answer = await askGemma<unknown>(`The player's choices:\n${describe(signals)}\n\nSuggest up to 20 PC games this player would most likely enjoy, best first.`, PICKS_SCHEMA);
    const picks = await resolveSuggestions(answer, signals);
    const state: AiPicksState = { at: Date.now(), signature, picks, fresh: kept?.fresh ?? [], freshAt: kept?.freshAt ?? 0 };
    savePicks(state);
    return state;
  })().finally(() => { running = null; });
  return running;
}

const FRESH_SCHEMA = { type: "object", properties: { picks: { type: "array", maxItems: 3, items: { type: "object", properties: { id: { type: "integer" }, why: { type: "string" } }, required: ["id", "why"] } } }, required: ["picks"] };

/** Keeps only answers about games that were offered, once each, with a reason. */
export function pickOffered(answer: unknown, offered: CatalogGame[], max: number): AiPick[] {
  const byId = new Map(offered.map(game => [game.id, game]));
  const items = Array.isArray((answer as { picks?: unknown })?.picks) ? (answer as { picks: Array<{ id?: unknown; why?: unknown }> }).picks : [];
  const picks: AiPick[] = [];
  for (const item of items) {
    const game = typeof item?.id === "number" ? byId.get(item.id) : undefined;
    const why = cleanWhy(item?.why);
    if (game && why && !picks.some(pick => pick.game.id === game.id)) picks.push({ game, why });
    if (picks.length >= max) break;
  }
  return picks;
}

const compact = (game: CatalogGame) => ({ id: game.id, name: game.name, genres: (game.genres ?? []).slice(0, 3), tags: (game.tags ?? []).slice(0, 5), released: game.release_date ?? undefined });

/** Once a day: the popular releases of the last 30 days go to Gemma, which may pick up to 3 for this player. */
export async function refreshFreshPicks(signals: TasteSignals): Promise<AiPicksState | null> {
  const kept = readPicks();
  if (!enoughSignals(signals) || !native()) return kept;
  if (kept && Date.now() - kept.freshAt < FRESH_TTL) return kept;
  const known = new Set([...signals.liked, ...signals.disliked, ...signals.library].map(norm));
  const recent = await queryCatalogCache({ max_age_days: 30, released_only: true, sort_by: "steam-popularity", sort_direction: "desc", limit: 40 }).catch(() => ({ items: [] as CatalogGame[] }));
  const offered = recent.items.filter(game => !known.has(norm(game.name))).slice(0, 30);
  if (!offered.length) return kept;
  const answer = await askGemma<unknown>(`The player's choices:\n${describe(signals)}\n\nNew PC games (JSON):\n${JSON.stringify(offered.map(compact))}\n\nPick at most 3 of these new games this player would really enjoy, by id. Pick none if none fits.`, FRESH_SCHEMA);
  const state: AiPicksState = { at: kept?.at ?? 0, signature: kept?.signature ?? "", picks: kept?.picks ?? [], fresh: pickOffered(answer, offered, 3), freshAt: Date.now() };
  savePicks(state);
  return state;
}

// ---- Asking in the player's own words (Seba, 2026-11-04) ----

export interface AiAnswer { reply: string; picks: AiPick[] }
const ASK_SCHEMA = { type: "object", properties: { reply: { type: "string" }, games: PICKS_SCHEMA.properties.games }, required: ["reply", "games"] };
const ASK_KEY = "gameaccess:ai-answers";

/** Gemma answers the player's request with up to 12 games (name and Steam id), each checked against the catalog. */
export async function aiAsk(text: string, signals: TasteSignals): Promise<AiAnswer | null> {
  const key = `${norm(text)}|${signalsSignature(signals)}`;
  const all = read<Record<string, AiAnswer & { at: number }>>(ASK_KEY, {});
  if (all[key] && Date.now() - all[key].at < QUERY_TTL) return all[key];
  if (!native()) return demoAnswer(text);
  const answer = await askGemma<{ reply?: unknown; games?: unknown }>(`The player asks: "${text.slice(0, 300)}"\nTheir choices:\n${describe(signals)}\n\nAnswer with "reply" (one or two friendly sentences on what you looked for) and "games": up to 12 PC games on Steam that fit the request, best first, each with its name, its Steam app id and a why. Never name a game the player already rated, has in the library or played.`, ASK_SCHEMA);
  const picks = await resolveSuggestions({ games: answer?.games }, signals);
  const result = { reply: cleanWhy(answer?.reply) || "", picks: picks.slice(0, 12) };
  const why = read<Record<number, { why: string; at: number }>>(WHY_KEY, {});
  for (const pick of result.picks) why[pick.game.id] = { why: pick.why, at: Date.now() };
  write(WHY_KEY, why);
  const entries = Object.entries({ ...all, [key]: { ...result, at: Date.now() } }).sort((a, b) => b[1].at - a[1].at).slice(0, 30);
  write(ASK_KEY, Object.fromEntries(entries));
  return result;
}

async function demoAnswer(text: string): Promise<AiAnswer | null> {
  if (!(import.meta.env.DEV && uiDemo())) return null;
  const found = await queryCatalogCache({ limit: 6, sort_by: "steam-popularity", sort_direction: "desc" }).catch(() => ({ items: [] as CatalogGame[] }));
  const es = getAppLocale() === "es";
  return {
    reply: es ? `Busqué juegos que encajen con «${text}» y con lo que te gusta.` : `I looked for games that fit "${text}" and what you like.`,
    picks: found.items.map(game => ({ game, why: es ? `Tiene ${(game.genres ?? ["lo que pediste"])[0]} y se juega como lo que buscás.` : `It has ${(game.genres ?? ["what you asked"])[0]} and plays like what you want.` })),
  };
}

// ---- Browser preview (`?uiDemo=1`): sample picks from the sample catalog, no AI. ----
async function demoState(signature: string, kept: AiPicksState | null): Promise<AiPicksState | null> {
  if (!(import.meta.env.DEV && uiDemo())) return kept;
  const found = await queryCatalogCache({ limit: 12, sort_by: "steam-popularity", sort_direction: "desc" }).catch(() => ({ items: [] as CatalogGame[] }));
  const es = getAppLocale() === "es";
  const picks = found.items.slice(2, 10).map((game, index) => ({ game, why: es ? `Te gustaron juegos parecidos de tu biblioteca: comparte ${(game.genres ?? ["el género"])[0]} y el ritmo que elegís (ejemplo ${index + 1}).` : `You liked similar games in your library: it shares ${(game.genres ?? ["the genre"])[0]} and the pace you pick (sample ${index + 1}).` }));
  const fresh = found.items.slice(0, 1).map(game => ({ game, why: es ? "Salió hace poco y se parece a lo que más jugás." : "It came out lately and is like what you play most." }));
  const state = { at: Date.now(), signature, picks, fresh, freshAt: Date.now() };
  savePicks(state);
  return state;
}

// ---- The magic button with an AI connected ----

const readRatings = (): Ratings => { try { return JSON.parse(localStorage.getItem("gameaccess:preferences") || "{}") as Ratings; } catch { return {}; } };

/**
 * The magic button (personalOrder.ts) as "search in words": with an AI connected it can be turned on from
 * MIN_SIGNALS choices (thumbs and library), without waiting for the taste profile. `on`: searches go to Gemma.
 */
export function useAiSearch(): { available: boolean; on: boolean; connected: boolean } {
  const order = usePersonalOrder();
  const connected = useAiConnected();
  // With an AI connected nothing else is asked (Seba, 2026-11-04): the thumbs only make the answers better.
  useEffect(() => { if (connected) void backfillTasteNames(); }, [connected]);
  return { available: connected, on: order.on && connected, connected };
}

let backfilling: Promise<boolean> | null = null;
/**
 * The names of games rated before names were kept with the thumbs (before 0.1.13): looked up in the catalog once, so
 * Gemma hears about every like and dislike. Resolves true when it found some (AI_SUGGESTIONS_EVENT is sent).
 */
export function backfillTasteNames(ratings: Ratings = readRatings()): Promise<boolean> {
  if (backfilling) return backfilling;
  const names = loadTasteNames();
  const missing = Object.keys(ratings).map(Number).filter(id => id > 0 && !names[id]).slice(0, 200);
  if (!missing.length) return Promise.resolve(false);
  backfilling = queryCatalogCache({ game_ids: missing, limit: missing.length })
    .then(result => {
      const found = Object.fromEntries(result.items.filter(game => game.name).map(game => [game.id, game.name]));
      if (!Object.keys(found).length) return false;
      rememberTasteNames(found);
      window.dispatchEvent(new Event(AI_SUGGESTIONS_EVENT));
      return true;
    })
    .catch(() => false)
    .finally(() => { backfilling = null; });
  return backfilling;
}

/** The player's signals, again whenever names were found or suggestions changed. */
export function useTasteSignals(): TasteSignals {
  const members = useLibraryGames();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick(value => value + 1);
    window.addEventListener(AI_SUGGESTIONS_EVENT, update);
    void backfillTasteNames();
    return () => window.removeEventListener(AI_SUGGESTIONS_EVENT, update);
  }, []);
  const [signals, setSignals] = useState(() => tasteSignals(readRatings(), loadTasteNames(), members));
  useEffect(() => setSignals(tasteSignals(readRatings(), loadTasteNames(), members)), [members, tick]);
  return signals;
}
