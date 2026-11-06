import { useEffect, useMemo, useState } from "react";
import { Search, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { genreLabel, offeredGenres } from "./libraryGenres";
import { GaIconButton } from "./components/ga/Buttons";
import { loadAiProfile, MULTIPLAYER_MODES, PREFERENCES_CHANGED_EVENT, PROFILE_TEXT_LIMIT, removeRating, saveAiProfile, type AiProfile, type MultiplayerMode, type PlayStyle } from "./aiProfile";
import { queryCatalogCache } from "./catalogCache";
import { useCatalogGenreNames } from "./catalogFilterParams";
import { useI18n } from "./i18n";
import { normalizeSearchText } from "./librarySearch";
import SteamCover from "./SteamCover";
import { loadTasteNames, type Ratings } from "./tasteProfile";
import type { CatalogGame } from "./types";

const readRatings = (): Ratings => { try { return JSON.parse(localStorage.getItem("gameaccess:preferences") || "{}") as Ratings; } catch { return {}; } };

type Shown = "all" | "liked" | "disliked";
type Sort = "name" | "name-desc" | "score" | "liked";
const SHOWN: Shown[] = ["all", "liked", "disliked"];
const SORTS: Sort[] = ["name", "name-desc", "score", "liked"];
const PLAY: PlayStyle[] = ["single", "multi", "both"];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return <button type="button" className="ga-settings-choice" aria-pressed={on} onClick={onClick}>{children}</button>;
}

/** The liked and disliked games: looked for, sorted and taken off the list. */
function RatedGames() {
  const { t } = useI18n();
  const [ratings, setRatings] = useState(readRatings);
  const [games, setGames] = useState<Map<number, CatalogGame>>(new Map());
  const [text, setText] = useState("");
  const [shown, setShown] = useState<Shown>("all");
  const [sort, setSort] = useState<Sort>("name");
  useEffect(() => {
    const reread = () => setRatings(readRatings());
    window.addEventListener(PREFERENCES_CHANGED_EVENT, reread);
    return () => window.removeEventListener(PREFERENCES_CHANGED_EVENT, reread);
  }, []);
  useEffect(() => {
    const ids = Object.keys(ratings).map(Number).filter(id => id > 0);
    if (!ids.length) return;
    let alive = true;
    void queryCatalogCache({ game_ids: ids, limit: ids.length })
      .then(result => { if (alive) setGames(new Map(result.items.map(game => [game.id, game]))); })
      .catch(() => undefined);
    return () => { alive = false; };
    // The games are looked up once: removing one only takes it off the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const names = useMemo(() => loadTasteNames(), []);
  const rows = useMemo(() => Object.entries(ratings)
    .map(([key, rating]) => { const id = Number(key); const game = games.get(id); return { id, rating, game, name: game?.name ?? names[id] ?? "" }; })
    .filter(row => row.name && (row.rating === 1 || row.rating === -1)), [ratings, games, names]);
  const visible = useMemo(() => {
    const needle = normalizeSearchText(text);
    const byName = (a: typeof rows[number], b: typeof rows[number]) => a.name.localeCompare(b.name);
    const order: Record<Sort, (a: typeof rows[number], b: typeof rows[number]) => number> = {
      name: byName,
      "name-desc": (a, b) => byName(b, a),
      score: (a, b) => (b.game?.steam_review_score ?? 0) - (a.game?.steam_review_score ?? 0) || byName(a, b),
      liked: (a, b) => b.rating - a.rating || byName(a, b),
    };
    return rows
      .filter(row => (shown === "all" || (shown === "liked") === (row.rating === 1)) && (!needle || normalizeSearchText(row.name).includes(needle)))
      .sort(order[sort]);
  }, [rows, text, shown, sort]);
  if (!rows.length) return <p className="ga-hint">{t("aiProfileNoGames")}</p>;
  return <>
    <div className="ga-profile-tools">
      <label className="ga-profile-search"><Search size={18} aria-hidden="true" />
        <input type="search" value={text} placeholder={t("aiProfileSearch")} aria-label={t("aiProfileSearch")} onChange={event => setText(event.target.value)} />
      </label>
      <div className="ga-settings-choices" role="group" aria-label={t("aiProfileShow")}>
        {SHOWN.map(option => <Chip key={option} on={shown === option} onClick={() => setShown(option)}>{t(`aiProfileShow_${option}`)}</Chip>)}
      </div>
      <select className="ga-settings-select" aria-label={t("aiProfileSort")} value={sort} onChange={event => setSort(event.target.value as Sort)}>
        {SORTS.map(option => <option key={option} value={option}>{t(`aiProfileSort_${option}`)}</option>)}
      </select>
    </div>
    {visible.length ? <ul className="ga-profile-games">
      {visible.map(row => <li key={row.id} className={row.rating === 1 ? "is-liked" : "is-disliked"}>
        <span className="ga-profile-cover">{row.game ? <SteamCover game={row.game} /> : null}</span>
        <span className="ga-profile-mark" title={t(row.rating === 1 ? "aiProfileLiked" : "aiProfileDisliked")}>{row.rating === 1 ? <ThumbsUp size={15} aria-hidden="true" /> : <ThumbsDown size={15} aria-hidden="true" />}</span>
        <GaIconButton className="ga-profile-remove" icon={<X size={16} aria-hidden="true" />} label={t("aiProfileRemove", { name: row.name })} onClick={() => removeRating(row.id)} />
        <span className="ga-profile-name">{row.name}</span>
      </li>)}
    </ul> : <p className="ga-hint">{t("aiProfileNoMatch")}</p>}
  </>;
}

/** Settings › AI › Your profile: everything here goes with each request to the AI (aiProfile.ts). */
export default function AiProfileEditor() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<AiProfile>(loadAiProfile);
  const update = (patch: Partial<AiProfile>) => { const next = { ...profile, ...patch }; setProfile(next); saveAiProfile(next); };
  const genreNames = useCatalogGenreNames();
  const genres = useMemo(() => offeredGenres(genreNames), [genreNames]);
  const rate = (id: string, value: 1 | -1) => {
    const next = { ...profile.genres };
    if (next[id] === value) delete next[id]; else next[id] = value;
    update({ genres: next });
  };
  const toggleMode = (mode: MultiplayerMode) => update({ modes: profile.modes.includes(mode) ? profile.modes.filter(item => item !== mode) : [...profile.modes, mode] });
  const multiplayer = profile.play === "multi" || profile.play === "both";

  return <section className="ga-profile" aria-labelledby="ga-profile-title">
    <div className="ga-stack">
      <h2 id="ga-profile-title" className="ga-heading ga-profile-title">{t("aiProfileTitle")}</h2>
      <p>{t("aiProfileIntro")}</p>
    </div>
    <fieldset className="ga-group ga-settings-group">
      <legend id="ga-profile-games" className="ga-label">{t("aiProfileGames")}</legend>
      <RatedGames />
    </fieldset>
    <fieldset className="ga-group ga-settings-group">
      <legend id="ga-profile-genres" className="ga-label">{t("aiProfileGenres")}</legend>
      <ul className="ga-profile-genres">
        {genres.map(id => { const name = genreLabel(id); const rating = profile.genres[id]; return <li key={id} className={rating === 1 ? "is-liked" : rating === -1 ? "is-disliked" : undefined}>
          <span>{name}</span>
          <GaIconButton icon={<ThumbsUp size={16} aria-hidden="true" />} label={t("aiProfileLikeGenre", { name })} pressed={rating === 1} onClick={() => rate(id, 1)} />
          <GaIconButton icon={<ThumbsDown size={16} aria-hidden="true" />} label={t("aiProfileDislikeGenre", { name })} pressed={rating === -1} onClick={() => rate(id, -1)} />
        </li>; })}
      </ul>
    </fieldset>
    <fieldset className="ga-group ga-settings-group">
      <legend id="ga-profile-play" className="ga-label">{t("aiProfilePlay")}</legend>
      <div className="ga-settings-choices" role="group" aria-labelledby="ga-profile-play">
        {PLAY.map(option => <Chip key={option} on={profile.play === option} onClick={() => update({ play: profile.play === option ? null : option })}>{t(`aiProfilePlay_${option}`)}</Chip>)}
      </div>
      {multiplayer ? <div className="ga-stack">
        <span id="ga-profile-modes" className="ga-label">{t("aiProfileModes")}</span>
        <div className="ga-settings-choices" role="group" aria-labelledby="ga-profile-modes">
          {MULTIPLAYER_MODES.map(mode => <Chip key={mode} on={profile.modes.includes(mode)} onClick={() => toggleMode(mode)}>{t(`aiProfileMode_${mode}`)}</Chip>)}
        </div>
      </div> : null}
    </fieldset>
    <div className="ga-profile-words">
      <label className="ga-group ga-settings-group"><span className="ga-label">{t("aiProfilePositive")}</span>
        <textarea className="ga-field" maxLength={PROFILE_TEXT_LIMIT} value={profile.positive} placeholder={t("aiProfilePositiveHint")} onChange={event => update({ positive: event.target.value })} />
      </label>
      <label className="ga-group ga-settings-group"><span className="ga-label">{t("aiProfileNegative")}</span>
        <textarea className="ga-field" maxLength={PROFILE_TEXT_LIMIT} value={profile.negative} placeholder={t("aiProfileNegativeHint")} onChange={event => update({ negative: event.target.value })} />
      </label>
    </div>
  </section>;
}
