import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { House, Sparkles } from "lucide-react";
import AccountCard from "./AccountCard";
import { ACTIVATION_CHANGED_EVENT, getActivationTier } from "./activation";
import { HelpContent } from "./AppHelp";
import { setAppScreen, useAppScreen } from "./appScreen";
import { AnnouncementBody } from "./centralDialog/CentralDialogView";
import { useNews } from "./centralDialog/useAnnouncements";
import { GaButton, GaIconButton } from "./components/ga/Buttons";
import GaScreen from "./components/ga/Screen";
import { useI18n } from "./i18n";
import NewsPanel from "./NewsPanel";
import { OPEN_PREMIUM_EVENT } from "./PremiumEntry";
import type { CatalogGame } from "./types";
import "./home-screen.css";

const subscribeTier = (listener: () => void) => {
  window.addEventListener(ACTIVATION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ACTIVATION_CHANGED_EVENT, listener);
};

/** "Good morning / afternoon / evening" by the hour. */
const greetingKey = (hour = new Date().getHours()) => hour >= 6 && hour < 13 ? "homeMorning" : hour >= 13 && hour < 20 ? "homeAfternoon" : "homeEvening";

/**
 * Home (docs/GUI_DESIGN.md §0b, docs/TAREA-pantallas-y-modos.md P8): the greeting, the welcome (it was a dialog over
 * the catalog; a new install opens here), PLUS or base mode explained, the player's account, the news (they took the
 * bell's place) and, at the end, help and contact. Stage: prototype.
 */
function Home({ games, onOpenGame }: { games: CatalogGame[]; onOpenGame: (game: CatalogGame) => void }) {
  const { t } = useI18n();
  const tier = useSyncExternalStore(subscribeTier, getActivationTier, () => null);
  const { welcome } = useNews();
  return <GaScreen id="ga-home" mode="home" title={t(greetingKey())} subtitle={t("homeSubtitle")} className="ga-home-screen">
    <div className="ga-home-content ga-stack ga-stack-lg">
      {welcome.map(item => <section key={item.id} className="ga-home-card ga-home-welcome" aria-labelledby={`ga-home-welcome-${item.id}`} data-announcement-id={item.id}>
        <h3 id={`ga-home-welcome-${item.id}`} className="ga-home-card-title">{item.title}</h3>
        <div className="ga-home-welcome-body ga-stack"><AnnouncementBody text={item.body} /></div>
      </section>)}
      <section className={tier ? "ga-home-card ga-home-plus is-on" : "ga-home-card ga-home-plus"} aria-labelledby="ga-home-plus-title">
        <div className="ga-stack">
          <h3 id="ga-home-plus-title" className="ga-home-card-title"><Sparkles size={20} aria-hidden="true" />{t(tier ? "homePlusOnTitle" : "homeBaseTitle")}</h3>
          <p>{t(tier ? "homePlusOnText" : "homeBaseText")}</p>
        </div>
        {tier ? null : <GaButton variant="primary" icon={<Sparkles size={16} aria-hidden="true" />} onClick={() => window.dispatchEvent(new Event(OPEN_PREMIUM_EVENT))}>{t("homeActivatePlus")}</GaButton>}
      </section>
      <AccountCard />
      <section className="ga-home-card" aria-labelledby="ga-home-news-title">
        <h3 id="ga-home-news-title" className="ga-home-card-title">{t("homeNewsTitle")}</h3>
        <NewsPanel games={games} onOpenGame={game => { setAppScreen("games"); onOpenGame(game); }} />
      </section>
      <section className="ga-home-card ga-home-help" aria-labelledby="ga-home-help-title">
        <h3 id="ga-home-help-title" className="ga-home-card-title">{t("homeHelpTitle")}</h3>
        <HelpContent />
      </section>
    </div>
  </GaScreen>;
}

/** The frame's Home button, with the unread news count, and the Home screen while it is the mode. */
export default function HomeScreen({ dockTarget = null, games, onOpenGame }: { dockTarget?: HTMLElement | null; games: CatalogGame[]; onOpenGame: (game: CatalogGame) => void }) {
  const { t } = useI18n();
  const screen = useAppScreen();
  const { unread } = useNews();
  const button = <GaIconButton className="ga-home-fab" icon={<House size={20} aria-hidden="true" />} label={t("screenHome")} badge={unread || undefined} pressed={screen === "home"} onClick={() => setAppScreen("home")} />;
  return <>
    {dockTarget ? createPortal(button, dockTarget) : button}
    {screen === "home" ? <Home games={games} onOpenGame={onOpenGame} /> : null}
  </>;
}
