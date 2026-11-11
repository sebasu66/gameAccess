import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { House, Sparkles } from "lucide-react";
import AccountCard from "./AccountCard";
import AiPicks from "./AiPicks";
import { ACTIVATION_CHANGED_EVENT, getActivationTier } from "./activation";
import { HelpContent } from "./AppHelp";
import { setAppScreen, useAppScreen } from "./appScreen";
import { AnnouncementBody } from "./centralDialog/CentralDialogView";
import { useNews } from "./centralDialog/useAnnouncements";
import { GaButton, GaIconButton } from "./components/ga/Buttons";
import GaScreen from "./components/ga/Screen";
import { useI18n } from "./i18n";
import { navigationShellEnabled } from "./navigation/navigationSelection";
import { sectionTab, selectNavigationSection, useNavigationSelection } from "./navigation/navigationSelection";
import NewsPanel from "./NewsPanel";
import { OPEN_PREMIUM_EVENT } from "./PremiumEntry";
import { OPEN_RELEASE_NOTES_EVENT, takePendingReleaseNotes, useReleaseNotes } from "./releaseNotes";
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
 * the catalog; a new install opens here), what changed in the installed version (changelog.json), PLUS or base
 * mode explained, the AI's picks (AiPicks.tsx), the player's account, the news (they took the bell's place) and, at the end, help and contact.
 * Stage: prototype.
 */
function Home({ games, onOpenGame }: { games: CatalogGame[]; onOpenGame: (game: CatalogGame) => void }) {
  const { t, locale } = useI18n();
  const tier = useSyncExternalStore(subscribeTier, getActivationTier, () => null);
  const { welcome, items } = useNews();
  const projectAnnouncements = items.filter(item => !item.games?.length);
  const notes = useReleaseNotes(locale);
  const newShell = navigationShellEnabled();
  const selection = useNavigationSelection();
  const chosen = selection.gameAccess;
  // Game Access › News, › Support and › Subscription show the submode chosen in the sections panel.
  const newsTab = newShell ? sectionTab("news", selection.tabs) : undefined;
  const supportTab = newShell ? sectionTab("support", selection.tabs) : undefined;
  const planTab = newShell ? sectionTab("subscription", selection.tabs) : undefined;
  const inSupport = (tab: string) => !newShell || chosen === "support" && supportTab === tab;
  const inSubscription = (tab: string) => !newShell || chosen === "subscription" && planTab === tab;
  const openGame = (game: CatalogGame) => { setAppScreen("games"); onOpenGame(game); };
  useEffect(() => {
    if (!notes) return;
    const show = () => { if (takePendingReleaseNotes()) {
      if (newShell) selectNavigationSection("gameAccess", "news");
      else document.getElementById("ga-home-changes-title")?.scrollIntoView({ block: "start", behavior: "smooth" });
    } };
    show();
    window.addEventListener(OPEN_RELEASE_NOTES_EVENT, show);
    return () => window.removeEventListener(OPEN_RELEASE_NOTES_EVENT, show);
  }, [notes, newShell]);
  // The new shell's Catalog › AI suggestions and Catalog › New games are drawn here until they get screens of their own.
  if (newShell && selection.homeMode === "catalog") return <GaScreen id="ga-home" mode="home" title={t(greetingKey())} subtitle={t("homeSubtitle")} className="ga-home-screen">
    <div className="ga-home-content ga-stack ga-stack-lg">
      {selection.catalog === "aiSuggestions" ? <AiPicks onOpenGame={openGame} /> : null}
      {selection.catalog === "newGames" ? <section className="ga-home-card" aria-labelledby="ga-home-news-title">
        <h3 id="ga-home-news-title" className="ga-home-card-title">{t("navNewGames")}</h3>
        <NewsPanel games={games} onOpenGame={openGame} downloadsOnly />
      </section> : null}
    </div>
  </GaScreen>;
  return <GaScreen id="ga-home" mode="home" title={t(greetingKey())} subtitle={t("homeSubtitle")} className="ga-home-screen">
    <div className="ga-home-content ga-stack ga-stack-lg">
      {inSupport("instructions") && welcome.map(item => <section key={item.id} className="ga-home-card ga-home-welcome" aria-labelledby={`ga-home-welcome-${item.id}`} data-announcement-id={item.id}>
        <h3 id={`ga-home-welcome-${item.id}`} className="ga-home-card-title">{item.title}</h3>
        <div className="ga-home-welcome-body ga-stack"><AnnouncementBody text={item.body} /></div>
      </section>)}
      {(!newShell || chosen === "news" && newsTab === "release") && notes ? <section className="ga-home-card ga-home-changes" aria-labelledby="ga-home-changes-title">
        <h3 id="ga-home-changes-title" className="ga-home-card-title">{t("homeChangesTitle", { version: notes.version })}</h3>
        <div className="ga-home-changes-body ga-stack"><AnnouncementBody text={notes.changes.map(line => `- ${line}`).join("\n")} /></div>
      </section> : null}
      {inSubscription("plan") ? <section className={tier ? "ga-home-card ga-home-plus is-on" : "ga-home-card ga-home-plus"} aria-labelledby="ga-home-plus-title">
        <div className="ga-stack">
          <h3 id="ga-home-plus-title" className="ga-home-card-title"><Sparkles size={20} aria-hidden="true" />{t(tier ? "homePlusOnTitle" : "homeBaseTitle")}</h3>
          <p>{t(tier ? "homePlusOnText" : "homeBaseText")}</p>
        </div>
        {tier ? null : <GaButton variant="primary" icon={<Sparkles size={16} aria-hidden="true" />} onClick={() => window.dispatchEvent(new Event(OPEN_PREMIUM_EVENT))}>{t("homeActivatePlus")}</GaButton>}
      </section> : null}
      {newShell ? null : <AiPicks onOpenGame={game => { setAppScreen("games"); onOpenGame(game); }} />}
      {inSubscription("account") ? <AccountCard /> : null}
      {newShell && chosen === "news" && newsTab === "announcements" ? <section className="ga-home-card" aria-labelledby="ga-home-news-title">
        <h3 id="ga-home-news-title" className="ga-home-card-title">{t("homeNewsTitle")}</h3>
        {projectAnnouncements.map(item => <article key={item.id} className="ga-home-welcome-body ga-stack">
          <h4>{item.title}</h4>
          <AnnouncementBody text={item.body} />
        </article>)}
        {projectAnnouncements.length ? null : <p className="ga-home-welcome-body">{t("homeNoAnnouncements")}</p>}
      </section> : null}
      {!newShell ? <section className="ga-home-card" aria-labelledby="ga-home-news-title">
        <h3 id="ga-home-news-title" className="ga-home-card-title">{t("homeNewsTitle")}</h3>
        <NewsPanel games={games} onOpenGame={game => { setAppScreen("games"); onOpenGame(game); }} />
      </section> : null}
      {!newShell || chosen === "support" && supportTab !== "instructions" ? <section className="ga-home-card ga-home-help" aria-labelledby="ga-home-help-title">
        <h3 id="ga-home-help-title" className="ga-home-card-title">{t("homeHelpTitle")}</h3>
        <HelpContent part={newShell ? supportTab as "faq" | "contact" : undefined} />
      </section> : null}
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
