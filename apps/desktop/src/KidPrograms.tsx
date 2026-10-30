import { useEffect, useState } from "react";
import { CheckCheck, ShieldOff, X } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { allowBlocked, loadDetectedPrograms, readRestrictionBlocks, setKidPrograms, toggleKidProgram, useKidState, type AllowedProgram, type RestrictionBlock } from "./kidMode";
import "./library-manager/manager.css";

/**
 * The programs allowed besides the child's games (vault/Modo niño.md, restrictor.rs): the installed programs of this PC,
 * read from Windows' own list. Programs start allowed; the parent unticks the ones the child must not open while kid mode
 * is on. Games installed outside the library and game stores come apart and start not allowed (games are assigned in
 * the library); Windows and Microsoft's programs are always allowed, so they are only counted. Same table and Yes/No
 * switch as the child's games (KidGamesGrid).
 */
const sameFolder = (left: string, right: string) => left.replace(/[\\/]+$/, "").toLowerCase() === right.replace(/[\\/]+$/, "").toLowerCase();

export default function KidPrograms() {
  const { t } = useI18n();
  const { detected, programs } = useKidState();
  useEffect(() => { void loadDetectedPrograms(); }, []);
  if (!detected) return <p className="ga-hint" role="status">{t("kidProgramsLoading")}</p>;
  const allowed = (folder: string) => programs.some(item => sameFolder(item.folder, folder));
  const installed = detected.filter(item => item.kind === "program");
  // A program allowed from the blocked list (not in Windows' list) is still shown, so it can be taken back.
  const added = programs.filter(item => !detected.some(row => sameFolder(row.folder, item.folder) && row.kind !== "program")
    && !installed.some(row => sameFolder(row.folder, item.folder))).map(item => ({ ...item, publisher: "" }));
  const rows = [...installed, ...added].sort((a, b) => a.name.localeCompare(b.name));
  const windows = detected.filter(item => item.kind === "windows").length;
  const games = detected.filter(item => item.kind === "game" || item.kind === "launcher").sort((a, b) => a.name.localeCompare(b.name));
  const all: AllowedProgram[] = rows.map(({ name, folder }) => ({ name, folder }));
  const table = (list: Array<AllowedProgram & { publisher: string }>) => <div className="lm-grid-wrap ga-kid-games">
    <table className="lm-grid">
      <thead><tr><th>{t("kidColProgram")}</th><th>{t("kidColAllowed")}</th></tr></thead>
      <tbody>{list.map(row => {
        const on = allowed(row.folder);
        return <tr key={row.folder} className={on ? "lm-row is-selected" : "lm-row"}>
          <td className="lm-cell-name"><div className="lm-name" title={row.folder}>{row.name}</div>{row.publisher ? <div className="ga-hint">{row.publisher}</div> : null}</td>
          <td><button type="button" className="ga-kid-switch" aria-pressed={on} aria-label={t("kidProgramAria", { name: row.name })} onClick={() => toggleKidProgram(row)}>
            <span>{on ? t("kidYes") : t("kidNo")}</span></button></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
  return <div className="ga-stack">
    <p className="ga-hint">{t("kidProgramsWindows", { count: String(windows) })}</p>
    {rows.length ? <>
      <div className="ga-actions">
        <GaButton icon={<CheckCheck size={16} aria-hidden="true" />} disabled={rows.every(row => allowed(row.folder))} onClick={() => setKidPrograms(all)}>{t("kidGamesAll")}</GaButton>
        <GaButton icon={<X size={16} aria-hidden="true" />} disabled={!programs.length} onClick={() => setKidPrograms([])}>{t("kidGamesNone")}</GaButton>
      </div>
      {table(rows)}
    </> : <p className="ga-hint">{t("kidProgramsEmpty")}</p>}
    {games.length ? <fieldset className="ga-group"><legend className="ga-label">{t("kidProgramsGamesTitle", { count: String(games.length) })}</legend>
      <p className="ga-hint">{t("kidProgramsGames")}</p>
      {table(games)}
    </fieldset> : null}
  </div>;
}

/** What kid mode closed, the latest first: a program can be allowed from here (a game is assigned in the library). */
export function KidBlocked() {
  const { t } = useI18n();
  const { programs } = useKidState();
  const [blocks, setBlocks] = useState<RestrictionBlock[]>([]);
  useEffect(() => {
    let stopped = false;
    const read = () => { void readRestrictionBlocks().then(next => { if (!stopped) setBlocks(next); }); };
    read();
    const timer = window.setInterval(read, 10_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  if (!blocks.length) return <p className="ga-hint">{t("kidBlockedEmpty")}</p>;
  const allowed = (path: string) => programs.some(item => path.toLowerCase().startsWith(item.folder.replace(/[\\/]+$/, "").toLowerCase() + "\\"));
  return <div className="lm-grid-wrap ga-kid-games">
    <table className="lm-grid">
      <thead><tr><th>{t("kidColProgram")}</th><th>{t("kidColBlocked")}</th><th><span className="sr-only">{t("kidAllow")}</span></th></tr></thead>
      <tbody>{blocks.map(block => <tr key={block.path} className="lm-row">
        <td className="lm-cell-name"><div className="lm-name" title={block.path}>{block.name}</div><div className="ga-hint">{block.game ? t("kidBlockedGame") : block.path}</div></td>
        <td><span className="ga-hint">{t("kidBlockedTimes", { count: String(block.count), when: new Date(block.at).toLocaleString() })}</span></td>
        <td>{block.game ? null : <GaButton icon={<ShieldOff size={16} aria-hidden="true" />} disabled={allowed(block.path)} onClick={() => allowBlocked(block)}>{allowed(block.path) ? t("kidAllowed") : t("kidAllow")}</GaButton>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
