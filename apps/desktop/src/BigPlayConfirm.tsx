/**
 * Big picture mode asks before starting a game (Seba, 2026-11-06): a press with the focus out of sight must not start
 * one. The game large, its short description and Play, on the smoke layer. The first moments do not count: the same
 * press that opened it, or a double click, does not go through. Stage: prototype.
 */
import { useRef } from "react";
import { Play } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { GaSmoke } from "./components/ga/GaSmoke";
import { useI18n } from "./i18n";
import { useBigPictureView } from "./bigPicture";
import type { CatalogGame } from "./types";
import "./big-play-confirm.css";

const ARMED_AFTER_MS = 350;

/** Plain text: a store description can bring tags and entities' leftovers. */
export const shortAbout = (game: Pick<CatalogGame, "short_description">) => (game.short_description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export default function BigPlayConfirm({ game, onPlay, onBack }: { game: CatalogGame; onPlay: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const { input } = useBigPictureView();
  const opened = useRef(performance.now());
  const play = () => { if (performance.now() - opened.current >= ARMED_AFTER_MS) onPlay(); };
  const art = game.hero_image ?? game.header_image ?? game.capsule_image;
  const about = shortAbout(game);
  return <GaSmoke className="ga-play-confirm" label={t("bigPlayLabel", { name: game.name })} onClose={onBack}>
    {art ? <img className="ga-play-confirm-art" src={art} alt="" /> : null}
    <h2 className="ga-play-confirm-title">{game.name}</h2>
    {about ? <p className="ga-play-confirm-about">{about}</p> : null}
    <div className="ga-actions">
      <GaButton data-autofocus variant="primary" size="tall" icon={<Play size={18} aria-hidden="true" />} onClick={play}>{t("bigPicturePlay")}</GaButton>
      <GaButton size="tall" onClick={onBack}>{t("bigPlayBack")}</GaButton>
    </div>
    <p className="ga-hint ga-play-confirm-keys">{input === "pad"
      ? <><span className="ga-pad-key is-a">A</span> {t("bigPicturePlay")} <span className="ga-pad-key">B</span> {t("bigPlayBack")}</>
      : <><kbd className="ga-pad-key">{t("bigKeyEnter")}</kbd> {t("bigPicturePlay")} <kbd className="ga-pad-key">{t("bigKeyEsc")}</kbd> {t("bigPlayBack")}</>}</p>
  </GaSmoke>;
}
