/**
 * The pieces of the game's detail as a file (Seba, 2026-11-17; docs/GUI_DESIGN.md §4.43), from his mock-up: the
 * game's logo as its title, the stat boxes, the panels with an icon, a title and stripes, the details list and the AI's
 * "more like this". LibraryDetailPanel (WideDetail) lays them out; sizes --ga-sheet-* in templates/base.css, colours
 * and type in the flavor.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "./i18n";
import { aiAsk, aiCompare, aiError, useAiSearch, useTasteSignals, type AiError, type AiPick } from "./aiSuggestions";
import { AiPickTile, AiSearchAnswer } from "./AiPicks";
import type { CatalogGame } from "./types";
import "./detail-sheet.css";

/** The plans page, loaded when asked: the shell is not imported up front (the detail also runs without it). */
const openPlans = () => void import("./navigation/NavigationShell").then(shell => shell.openPlans());

type Logo = { src: string; aspect: number } | "none";
const logos = new Map<string, Promise<Logo>>();

/**
 * Steam's logo.png is a 640x360 canvas with the logo somewhere inside it, so logos looked of different sizes (Seba,
 * 2026-11-17). The transparent margin is cut off once per logo (Steam's CDN allows it); when it cannot be read, the
 * picture is used as it comes.
 */
function trimmedLogo(url: string): Promise<Logo> {
  let pending = logos.get(url);
  if (!pending) {
    pending = new Promise<Logo>(resolve => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onerror = () => resolve("none");
      image.onload = () => {
        const whole = { src: url, aspect: image.naturalWidth / Math.max(1, image.naturalHeight) };
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) { resolve(whole); return; }
          context.drawImage(image, 0, 0);
          const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
          let top = height, left = width, right = -1, bottom = -1;
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] < 16) continue;
            if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
          }
          if (right < left || bottom < top) { resolve(whole); return; }
          const cut = document.createElement("canvas");
          cut.width = right - left + 1; cut.height = bottom - top + 1;
          cut.getContext("2d")?.drawImage(canvas, left, top, cut.width, cut.height, 0, 0, cut.width, cut.height);
          cut.toBlob(blob => resolve(blob ? { src: URL.createObjectURL(blob), aspect: cut.width / cut.height } : whole));
        } catch { resolve(whole); }
      };
      image.src = url;
    });
    logos.set(url, pending);
  }
  return pending;
}

/**
 * The game's logo from Steam as its title, its margin cut off; its name in big type when there is none. Its shape is
 * passed on so the CSS gives every logo about the same area: a wide one is shorter, a tall one narrower.
 */
export function GameLogo({ appId, name, titleRef }: { appId: number | null | undefined; name: string; titleRef: RefObject<HTMLHeadingElement> }) {
  const [logo, setLogo] = useState<Logo | null>(null);
  useEffect(() => {
    let alive = true;
    setLogo(appId ? null : "none");
    if (appId) void trimmedLogo(`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/logo.png`).then(found => { if (alive) setLogo(found); });
    return () => { alive = false; };
  }, [appId]);
  const shown = logo && logo !== "none" ? logo : null;
  return <h1 ref={titleRef} className={shown ? "ga-sheet-title has-logo" : logo === null ? "ga-sheet-title has-logo is-waiting" : "ga-sheet-title"}>
    {shown ? <img src={shown.src} alt={name} draggable={false} style={{ ["--ga-logo-aspect" as string]: shown.aspect.toFixed(3) }} onError={() => setLogo("none")} />
      : logo === null ? <span className="ga-visually-hidden">{name}</span> : name}
  </h1>;
}

/** A panel: an icon, its title in the display type, stripes on the right, then its content. */
export function SheetPanel({ icon, title, className, children, panelRef, action }: { icon: ReactNode; title: string; className?: string; children: ReactNode; panelRef?: RefObject<HTMLElement>; action?: ReactNode }) {
  return <section ref={panelRef} className={className ? `ga-sheet-panel ${className}` : "ga-sheet-panel"}>
    <h2 className="ga-sheet-panel-head"><span className="ga-sheet-panel-icon" aria-hidden="true">{icon}</span>{title}<i className="ga-sheet-stripes" aria-hidden="true" />{action}</h2>
    <div className="ga-sheet-panel-body">{children}</div>
  </section>;
}

/** A stat box: a big value (`text`: words, a size smaller), then an icon and its label. */
const SCORE_SEGMENTS = 10;

/**
 * The score (Seba, 2026-11-17): its number, a segmented bar and a small label under it. Green when the game is well
 * rated, amber when mixed, red when poor: Steam's own bands for its positive reviews (70 and 40), Metacritic's for
 * its score (75 and 50).
 */
export function SheetScore({ value, percent, label, source }: { value: number; percent: boolean; label: string; source: "steam" | "metacritic" }) {
  const [good, mixed] = source === "steam" ? [70, 40] : [75, 50];
  const tone = value >= good ? "is-good" : value >= mixed ? "is-mixed" : "is-poor";
  const lit = Math.round(value / (100 / SCORE_SEGMENTS));
  return <div className={`ga-sheet-score ${tone}`}>
    <b>{value}{percent ? <small>%</small> : null}</b>
    <span className="ga-sheet-score-bar" aria-hidden="true">{Array.from({ length: SCORE_SEGMENTS }, (_, index) => <i key={index} className={index < lit ? "is-on" : undefined} />)}</span>
    <span className="ga-sheet-score-label">{label}</span>
  </div>;
}

/** The details list: an icon, a label and a value per row. */
export function SheetRows({ rows }: { rows: Array<{ icon: ReactNode; label: string; value: ReactNode }> }) {
  return <dl className="ga-sheet-rows">{rows.map(row => <div key={row.label}>
    <dt><span aria-hidden="true">{row.icon}</span>{row.label}</dt><dd>{row.value}</dd>
  </div>)}</dl>;
}

type Similar = { reply: string; picks: AiPick[]; error: AiError | null; busy: boolean };

/** "More like this": asks the AI for games like this one (a PLUS feature: without PLUS it opens the plans). */
export function useMoreLikeThis(game: CatalogGame) {
  const { t } = useI18n();
  const { plus, connected } = useAiSearch();
  const signals = useTasteSignals();
  const [state, setState] = useState<Similar | null>(null);
  const asked = useRef(0);
  useEffect(() => { asked.current++; setState(null); }, [game.id]);
  const ask = () => {
    if (!plus) { openPlans(); return; }
    const request = ++asked.current;
    setState({ reply: "", picks: [], error: null, busy: true });
    aiAsk(t("detailMoreLikeQuery", { name: game.name }), signals)
      .then(answer => { if (request === asked.current) setState({ reply: answer?.reply ?? "", picks: (answer?.picks ?? []).filter(pick => pick.game.id !== game.id), error: null, busy: false }); })
      .catch(error => { if (request === asked.current) setState({ reply: "", picks: [], error: aiError(error), busy: false }); });
  };
  return { state, ask, connected };
}

/** Whether the guide can be asked here: PLUS with the AI connected (Seba, 2026-11-17: optional things only show when they work). */
export function useDetailAiReady() {
  const { plus, connected } = useAiSearch();
  return plus && connected;
}

/**
 * «Preguntarle a la IA» (Seba, 2026-11-17): the right column's AI panel. The two questions as links, one under the
 * other (games like this one; whether it is like others the player played), then the answers: the found games last,
 * since their list is long.
 */
export function AskDetailAi({ game, similar, canShowRelated }: { game: CatalogGame; similar: ReturnType<typeof useMoreLikeThis>; canShowRelated: boolean }) {
  const { t } = useI18n();
  const busy = Boolean(similar.state?.busy);
  return <div className="ga-sheet-asks">
    <button type="button" className="ga-sheet-ask-link" onClick={similar.ask} disabled={busy} aria-busy={busy}><Sparkles aria-hidden="true" />{t("detailMoreLike")}</button>
    <AiCompare game={game} />
    {similar.state ? <MoreLikeThisAnswer game={game} state={similar.state} connected={similar.connected} canShowRelated={canShowRelated} /> : null}
  </div>;
}

/**
 * The AI section's question (Seba, 2026-11-17): a link that asks whether this game is like others the player played,
 * and the answer under it. A PLUS feature: without PLUS it opens the plans.
 */
export function AiCompare({ game }: { game: CatalogGame }) {
  const { t } = useI18n();
  const { plus, connected } = useAiSearch();
  const signals = useTasteSignals();
  const [answer, setAnswer] = useState<{ text: string; error: AiError | null; busy: boolean } | null>(null);
  const asked = useRef(0);
  useEffect(() => { asked.current++; setAnswer(null); }, [game.id]);
  const ask = () => {
    if (!plus) { openPlans(); return; }
    const request = ++asked.current;
    setAnswer({ text: "", error: null, busy: true });
    aiCompare(game, signals)
      .then(text => { if (request === asked.current) setAnswer({ text: text ?? "", error: null, busy: false }); })
      .catch(error => { if (request === asked.current) setAnswer({ text: "", error: aiError(error), busy: false }); });
  };
  return <div className="ga-sheet-ask">
    <button type="button" className="ga-sheet-ask-link" onClick={ask} disabled={answer?.busy} aria-busy={answer?.busy}><Sparkles aria-hidden="true" />{t("detailAiCompare")}</button>
    {answer ? <AiSearchAnswer busy={answer.busy} reply={answer.text} count={answer.text ? 1 : 0} error={answer.error} idle={false} connected={connected || answer.busy || Boolean(answer.text)} /> : null}
  </div>;
}

/** The answer in the right column: what was searched, then the games found, one under the other with the AI's reason. */
export function MoreLikeThisAnswer({ game, state, connected, canShowRelated }: { game: CatalogGame; state: Similar; connected: boolean; canShowRelated: boolean }) {
  const { t } = useI18n();
  return <div className="ga-sheet-similar">
    <AiSearchAnswer busy={state.busy} reply={state.reply || t("detailMoreLikeFound", { name: game.name })} count={state.picks.length} error={state.error} idle={false} connected={connected || state.busy || state.picks.length > 0} />
    {canShowRelated && state.picks.length > 0 ? <p className="ga-hint">{t("detailSheetRelatedFound", { name: game.name })}</p> : null}
  </div>;
}

export function RelatedGames({ picks, onOpenGame }: { picks: AiPick[]; onOpenGame: (game: CatalogGame) => void }) {
  return <div className="ga-sheet-similar"><ul className="ga-ai-picks">
    {picks.map(pick => <AiPickTile key={pick.game.id} pick={pick} onOpenGame={onOpenGame} />)}
  </ul></div>;
}
