import { useEffect, useMemo, useRef, useState } from "react";
import { queryCatalogCache } from "./catalogCache";
import { AnnouncementBody } from "./centralDialog/CentralDialogView";
import { markNewsRead, useNews } from "./centralDialog/useAnnouncements";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { OPEN_NEWS_EVENT, takePendingNews } from "./newDownloads";
import SteamCover from "./SteamCover";
import type { CatalogGame } from "./types";
import "./news-panel.css";

const TIPS = ["newsTip1", "newsTip2", "newsTip3"] as const;

/** How many covers show before "See all": a news item can bring hundreds of games. */
const FIRST = 24;

/**
 * Games as a grid of covers with their names (Seba, 2026-11-02: the long list showed little in much space); each
 * opens its game's detail. Long ones show the first FIRST and "See all".
 */
function GameGrid({ games, onOpenGame }: { games: CatalogGame[]; onOpenGame: (game: CatalogGame) => void }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const shown = all ? games : games.slice(0, FIRST);
  return <div className="ga-stack">
    <ul className="ga-news-grid">
      {shown.map(game => <li key={game.id}>
        <button type="button" className="ga-news-tile" aria-label={t("selectGameAria", { name: game.name })} onClick={() => onOpenGame(game)}>
          <span className="ga-news-tile-cover"><SteamCover game={game} /></span>
          <span className="ga-news-tile-name">{game.name}</span>
        </button>
      </li>)}
    </ul>
    {games.length > FIRST ? <div className="ga-actions"><GaButton onClick={() => setAll(value => !value)}>{all ? t("newsShowLess") : t("newsShowAll", { count: games.length })}</GaButton></div> : null}
  </div>;
}

/** The games a news item lists (by app id, read from the catalog database), as a grid that opens their detail. */
function NewsGames({ appIds, onOpenGame }: { appIds: number[]; onOpenGame: (game: CatalogGame) => void }) {
  const [games, setGames] = useState<CatalogGame[]>([]);
  const key = appIds.join(",");
  useEffect(() => {
    let alive = true;
    void queryCatalogCache({ app_ids: appIds, limit: appIds.length }).then(result => {
      if (!alive || !result) return;
      const order = new Map(appIds.map((id, index) => [id, index]));
      setGames([...result.items].sort((a, b) => (order.get(a.app_id ?? 0) ?? 0) - (order.get(b.app_id ?? 0) ?? 0)));
    }).catch(() => undefined);
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!games.length) return null;
  return <GameGrid games={games} onOpenGame={onOpenGame} />;
}
const DAY = 86_400_000;

/**
 * News as a panel (docs/TAREA-interfaz-nueva.md T13): the latest news card (date, title, text), older news, the
 * games that just arrived in the catalog (View opens their detail) and a usage tip. Opening it marks the news read.
 */
export default function NewsPanel({ games, onOpenGame }: { games: CatalogGame[]; onOpenGame: (game: CatalogGame) => void }) {
  const { t, locale } = useI18n();
  const { items } = useNews();
  useEffect(() => { markNewsRead(); }, [items.length]);
  const recent = useMemo(() => games
    .filter(game => game.release_date && Date.now() - Date.parse(game.release_date) < 30 * DAY && Date.parse(game.release_date) <= Date.now())
    .sort((a, b) => Date.parse(b.release_date ?? "") - Date.parse(a.release_date ?? ""))
    .slice(0, 4), [games]);
  const tip = TIPS[new Date().getDate() % TIPS.length];
  const date = (value?: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(locale === "es" ? "es-AR" : "en-US", { day: "numeric", month: "long", year: "numeric" }) : "";
  const [latest, ...older] = items;
  // A notice or an Activity entry asked for one news item: it opens and comes into view.
  const [focus, setFocus] = useState<string | null>(() => takePendingNews());
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (event: Event) => { takePendingNews(); setFocus((event as CustomEvent<string>).detail); };
    window.addEventListener(OPEN_NEWS_EVENT, show);
    return () => window.removeEventListener(OPEN_NEWS_EVENT, show);
  }, []);
  useEffect(() => {
    if (!focus) return;
    root.current?.querySelector(`[data-news-id="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focus, items.length]);
  return (
    <div className="ga-news" ref={root}>
      {latest ? <article className="ga-news-latest" data-news-id={latest.id}>
        <span className="ga-news-eyebrow">{t("newsLatest")}{latest.date ? ` · ${date(latest.date)}` : ""}</span>
        <h3>{latest.title}</h3>
        <AnnouncementBody text={latest.body} />
        {latest.games?.length ? <NewsGames appIds={latest.games} onOpenGame={onOpenGame} /> : null}
      </article> : <p className="ga-news-empty">{t("newsEmpty")}</p>}
      {recent.length ? <section>
        <h4 className="ga-news-section">{t("newsNewInCatalog")}</h4>
        <GameGrid games={recent} onOpenGame={onOpenGame} />
      </section> : null}
      {older.length ? <section>
        <h4 className="ga-news-section">{t("newsOlder")}</h4>
        {older.map(item => <details key={item.id} className="ga-news-older" data-news-id={item.id} open={focus === item.id || undefined}><summary><b>{item.title}</b>{item.date ? <span>{date(item.date)}</span> : null}</summary><AnnouncementBody text={item.body} />{item.games?.length ? <NewsGames appIds={item.games} onOpenGame={onOpenGame} /> : null}</details>)}
      </section> : null}
      <p className="ga-news-tip"><b>{t("newsTipTitle")}</b> {t(tip)}</p>
    </div>
  );
}
