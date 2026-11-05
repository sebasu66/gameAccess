import { useEffect, useState, type ReactNode } from "react";
import { Sparkles, Square, ThumbsDown, ThumbsUp, Volume2 } from "lucide-react";
import { aiState, openAiSettings } from "./aiConnection";
import { AI_SUGGESTIONS_EVENT, aiError, aiExplain, aiWhy, enoughSignals, useTasteSignals, MIN_SIGNALS, readPicks, refreshFreshPicks, refreshPicks, signalCount, tasteSignals, type AiError, type AiPick, type AiPicksState } from "./aiSuggestions";
import { setAppScreen } from "./appScreen";
import { GaButton, GaIconButton } from "./components/ga/Buttons";
import { speak, stopSpeaking, useSpeaking, voiceAvailable } from "./aiVoice";
import { useI18n } from "./i18n";
import SteamCover from "./SteamCover";
import type { Ratings } from "./tasteProfile";
import type { CatalogGame } from "./types";
import "./ai-picks.css";

const readRatings = (): Ratings => { try { return JSON.parse(localStorage.getItem("gameaccess:preferences") || "{}") as Ratings; } catch { return {}; } };

/** One suggested game: its cover, name and the AI's reason; it opens the game's detail. */
export function AiPickTile({ pick, onOpenGame, fresh = false }: { pick: AiPick; onOpenGame: (game: CatalogGame) => void; fresh?: boolean }) {
  const { t } = useI18n();
  return <li>
    <button type="button" className={fresh ? "ga-ai-pick is-fresh" : "ga-ai-pick"} aria-label={t("selectGameAria", { name: pick.game.name })} onClick={() => onOpenGame(pick.game)}>
      <span className="ga-ai-pick-cover"><SteamCover game={pick.game} /></span>
      <span className="ga-ai-pick-text">
        {fresh ? <span className="ga-ai-pick-badge">{t("aiPicksNew")}</span> : null}
        <span className="ga-ai-pick-name">{pick.game.name}</span>
        <span className="ga-ai-pick-why">{pick.why}</span>
      </span>
    </button>
  </li>;
}

/**
 * Home's AI card (Seba, 2026-11-04; aiSuggestions.ts): it explains that the thumbs and the library teach the AI the
 * player's taste, shows how far along that is and, once there is enough, the games Gemma picked with their reason,
 * plus a new release that fits when there is one. Without a connected AI it explains how to connect one.
 */
export default function AiPicks({ onOpenGame }: { onOpenGame: (game: CatalogGame) => void }) {
  const { t } = useI18n();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [state, setState] = useState<AiPicksState | null>(() => readPicks());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  const signals = useTasteSignals();
  const ready = enoughSignals(signals);

  useEffect(() => { void aiState().then(value => setConnected(value.connected)).catch(() => setConnected(false)); }, []);
  useEffect(() => {
    const update = () => setState(readPicks());
    window.addEventListener(AI_SUGGESTIONS_EVENT, update);
    return () => window.removeEventListener(AI_SUGGESTIONS_EVENT, update);
  }, []);

  const ask = async (force = false) => {
    setBusy(true); setError(null);
    try {
      const next = await refreshPicks(signals, { force });
      if (next) setState(next);
      const fresh = await refreshFreshPicks(signals).catch(() => null);
      if (fresh) setState(fresh);
    } catch (reason) { setError(aiError(reason)); } finally { setBusy(false); }
  };
  useEffect(() => { if (connected && ready) void ask(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, ready]);

  const picks = state?.picks ?? [];
  const fresh = (state?.fresh ?? []).filter(item => !picks.some(pick => pick.game.id === item.game.id));
  return <section className="ga-home-card ga-ai-picks" aria-labelledby="ga-ai-picks-title" aria-busy={busy}>
    <div className="ga-ai-picks-head">
      <div className="ga-stack">
        <h3 id="ga-ai-picks-title" className="ga-home-card-title"><Sparkles size={20} aria-hidden="true" />{t("aiPicksTitle")}</h3>
        <p>{t("aiPicksIntro")}</p>
        <p className="ga-ai-picks-how"><ThumbsUp size={16} aria-hidden="true" /><ThumbsDown size={16} aria-hidden="true" />{t("aiPicksHow")}</p>
      </div>
      {connected === false ? <GaButton variant="primary" icon={<Sparkles size={16} aria-hidden="true" />} onClick={() => setAppScreen("settings")}>{t("aiPicksConnect")}</GaButton>
        : connected && ready ? <GaButton disabled={busy} onClick={() => void ask(true)}>{busy ? t("aiPicksThinking") : t("aiPicksAgain")}</GaButton> : null}
    </div>
    {connected === false ? <p className="ga-ai-picks-note">{t("aiPicksNeedsAi")}</p>
      : !ready ? <div className="ga-ai-picks-progress">
          <span className="ga-ai-picks-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, signalCount(signals) / MIN_SIGNALS * 100)}%` }} /></span>
          <span>{t("aiPicksProgress", { count: Math.min(signalCount(signals), MIN_SIGNALS), total: MIN_SIGNALS })}</span>
        </div> : null}
    {error ? <p className="ga-ai-picks-note" role="status">{t(`aiError_${error}`)}</p> : null}
    {busy && !picks.length ? <p className="ga-ai-picks-note" role="status">{t("aiPicksThinking")}</p> : null}
    {fresh.length || picks.length ? <ul className="ga-ai-picks-list">
      {fresh.map(pick => <AiPickTile key={`fresh-${pick.game.id}`} pick={pick} onOpenGame={onOpenGame} fresh />)}
      {picks.map(pick => <AiPickTile key={pick.game.id} pick={pick} onOpenGame={onOpenGame} />)}
    </ul> : null}
  </section>;
}

/** Reads the panel's text aloud in Gemma's voice (aiVoice.ts), or stops it. */
function SpeakButton({ text }: { text: string }) {
  const { t } = useI18n();
  const now = useSpeaking(text);
  if (!voiceAvailable() || !text) return null;
  return <GaIconButton className="ga-ai-speak" icon={now ? <Square size={14} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />} label={t(now ? "aiVoiceStop" : "aiVoiceListen")} pressed={now} onClick={() => now ? stopSpeaking() : speak(text)} />;
}

/**
 * The detail's glass panel for a game Gemma suggested (Seba, 2026-11-04): her short reason right away, then her
 * longer explanation, asked once when the detail opens (aiExplain). Games she did not suggest show nothing.
 */
export function AiReasonPanel({ game }: { game: CatalogGame }) {
  const { t } = useI18n();
  const [short] = useState(() => aiWhy(game.id));
  const [long, setLong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!short) return;
    let alive = true;
    setBusy(true);
    void aiExplain(game, tasteSignals(readRatings())).then(text => { if (alive && text) setLong(text); }).catch(() => undefined).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [game, short]);
  if (!short) return null;
  return <section className="ga-ai-reason" aria-labelledby={`ga-ai-reason-${game.id}`} aria-busy={busy}>
    <div className="ga-ai-reason-head"><h4 id={`ga-ai-reason-${game.id}`}><Sparkles size={16} aria-hidden="true" />{t("aiReasonTitle")}</h4><SpeakButton text={long ?? short} /></div>
    <p>{long ?? short}</p>
    {busy && !long ? <p className="ga-ai-reason-more" role="status">{t("aiReasonMore")}</p> : null}
  </section>;
}

/**
 * The message on top of the catalog with AI search on: what the AI understood, that it is thinking, what is missing to
 * ask it, or that it needs a key (with the way to Settings › AI).
 */
export function AiSearchAnswer({ busy, reply, count, error, idle, connected }: { busy: boolean; reply: string; count: number; error: AiError | null; idle: boolean; connected: boolean }) {
  const { t } = useI18n();
  const needsKey = !connected || error === "no_key";
  const text = needsKey ? t("aiSearchNeedsKey") : busy ? t("aiAskThinking") : idle ? t("aiAskIdle") : error ? t(`aiError_${error}`) : count ? reply || t("aiAskFound") : t("aiAskNothing");
  return <section className="ga-ai-reason ga-ai-search-answer" aria-live="polite" aria-busy={busy}>
    <div className="ga-ai-reason-head"><h4><Sparkles size={16} aria-hidden="true" />{t("aiAskTitle")}</h4>{busy || error || needsKey ? null : <SpeakButton text={text} />}</div>
    <p>{text}</p>
    {needsKey ? <div className="ga-actions"><GaButton variant="primary" icon={<Sparkles size={16} aria-hidden="true" />} onClick={openAiSettings}>{t("aiPicksConnect")}</GaButton></div> : null}
  </section>;
}

/**
 * The grid with AI search on (Seba, 2026-11-05): each game takes two cells, its card and, beside it, the AI's reason on
 * a soft shade like the card's context menu. That menu comes up in the same place, so the reason gives way while it is open.
 */
export function AiResults({ games, reasons, menuGameId, renderCard }: { games: CatalogGame[]; reasons: Map<number, string>; menuGameId?: number; renderCard: (game: CatalogGame) => ReactNode }) {
  return <ul className="ga-ai-results">
    {games.map(game => <li key={game.id} className="ga-ai-result">
      {renderCard(game)}
      <div className={game.id === menuGameId ? "ga-ai-result-why is-hidden" : "ga-ai-result-why"}>
        <p>{reasons.get(game.id)}</p>
      </div>
    </li>)}
  </ul>;
}
