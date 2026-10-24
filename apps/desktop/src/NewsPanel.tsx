import { useEffect, useMemo } from "react";
import { AnnouncementBody } from "./centralDialog/CentralDialogView";
import { markNewsRead, useNews } from "./centralDialog/useAnnouncements";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import SteamCover from "./SteamCover";
import type { CatalogGame } from "./types";
import "./news-panel.css";

const TIPS = ["newsTip1", "newsTip2", "newsTip3"] as const;
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
  return (
    <div className="ga-news">
      {latest ? <article className="ga-news-latest">
        <span className="ga-news-eyebrow">{t("newsLatest")}{latest.date ? ` · ${date(latest.date)}` : ""}</span>
        <h3>{latest.title}</h3>
        <AnnouncementBody text={latest.body} />
      </article> : <p className="ga-news-empty">{t("newsEmpty")}</p>}
      {recent.length ? <section>
        <h4 className="ga-news-section">{t("newsNewInCatalog")}</h4>
        <ul className="ga-news-games">
          {recent.map(game => <li key={game.id}>
            <span className="ga-news-cover"><SteamCover game={game} /></span>
            <div><b>{game.name}</b><span>{date(game.release_date?.slice(0, 10))}</span></div>
            <GaButton variant="secondary" onClick={() => onOpenGame(game)}>{t("newsSee")}</GaButton>
          </li>)}
        </ul>
      </section> : null}
      {older.length ? <section>
        <h4 className="ga-news-section">{t("newsOlder")}</h4>
        {older.map(item => <details key={item.id} className="ga-news-older"><summary><b>{item.title}</b>{item.date ? <span>{date(item.date)}</span> : null}</summary><AnnouncementBody text={item.body} /></details>)}
      </section> : null}
      <p className="ga-news-tip"><b>{t("newsTipTitle")}</b> {t(tip)}</p>
    </div>
  );
}
