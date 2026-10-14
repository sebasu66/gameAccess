import { Download, Minus, Plus } from "lucide-react";
import QualitySliders from "./QualitySliders";
import type { LibrarySearchFilters } from "./librarySearch";
import type { TriState } from "./TriStateOption";

const NEXT: Record<TriState, TriState> = { off: "include", include: "exclude", exclude: "off" };

/**
 * Step 3 of the filter wizard: review bar, release years, download sources and
 * whether to look for games or programs.
 */
export default function ExtrasPicker({ draft, onChange, sourceNames, sourceState, onSource, gameCount, softwareCount }: {
  draft: LibrarySearchFilters;
  onChange: (patch: Partial<LibrarySearchFilters>) => void;
  sourceNames: string[];
  sourceState: (name: string) => TriState;
  onSource: (name: string, state: TriState) => void;
  gameCount: number;
  softwareCount: number;
}) {
  const programs = draft.software === true;
  return (
    <div className="ga-wiz-extras">
      <div className="ga-wiz-kind" role="group" aria-label="Qué buscás">
        <button type="button" className={programs ? "" : "is-on"} aria-pressed={!programs} onClick={() => onChange({ software: false })}>
          Juegos <small>{gameCount}</small>
        </button>
        <button type="button" className={programs ? "is-on" : ""} aria-pressed={programs} onClick={() => onChange({ software: true })}
          title="Blender, OBS Studio, Godot Engine y similares: software que Steam lista dentro del catálogo">
          Programas <small>{softwareCount}</small>
        </button>
      </div>
      {programs ? <p className="ga-wiz-hint">Los programas no tienen PvP, ni LAN, ni modo historia: los demás filtros no se aplican.</p> : null}
      <QualitySliders draft={draft} onChange={onChange} />
      <section className="ga-wiz-sources" aria-label="Fuentes de descarga">
        <h4><Download size={15} aria-hidden="true" /> Fuentes de descarga</h4>
        {sourceNames.length === 0
          ? <p className="ga-wiz-hint">Todavía no importaste fuentes. Cuando lo hagas, vas a poder pedir juegos que tengan una fuente puntual.</p>
          : <div className="ga-wiz-chips">{sourceNames.map(name => {
            const state = sourceState(name);
            return <button key={name} type="button" className={`ga-wiz-chip is-${state}`} aria-pressed={state !== "off"}
              aria-label={`${name}: ${state === "include" ? "exigida" : state === "exclude" ? "excluida" : "sin elegir"}`}
              onClick={() => onSource(name, NEXT[state])}>
              {state === "include" ? <Plus size={13} aria-hidden="true" /> : state === "exclude" ? <Minus size={13} aria-hidden="true" /> : null}
              {name}
            </button>;
          })}</div>}
      </section>
    </div>
  );
}
