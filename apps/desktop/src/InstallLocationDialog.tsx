import { useMemo, useState } from "react";
import { Check, HardDrive, X } from "lucide-react";

import type { SteamLibraryFolder } from "./native";
import type { CatalogGame } from "./types";

export function InstallLocationDialog({
  game,
  libraries,
  onConfirm,
  onCancel,
}: {
  game: CatalogGame;
  libraries: SteamLibraryFolder[];
  onConfirm: (libraryIndex: number) => void;
  onCancel: () => void;
}) {
  const preferred = Number(localStorage.getItem("gameaccess:steam-library-index"));
  const initial = useMemo(
    () => libraries.some((library) => library.index === preferred) ? preferred : libraries[0]?.index ?? 0,
    [libraries, preferred],
  );
  const [selectedIndex, setSelectedIndex] = useState(initial);

  const confirm = () => {
    localStorage.setItem("gameaccess:steam-library-index", String(selectedIndex));
    onConfirm(selectedIndex);
  };

  return (
    <div role="presentation" className="modal-backdrop" onPointerDown={onCancel}>
      <section
        className="game-options-dialog"
        style={{ width: "min(580px, 92vw)" }}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Elegir ubicación de instalación para ${game.name}`}
      >
        <span className="eyebrow">UBICACIÓN DE INSTALACIÓN</span>
        <h2>{game.name}</h2>
        <p>Elegí en qué biblioteca de Steam querés guardar el juego. GameAccess usará esta ubicación sin abrir el selector de Steam.</p>

        <div style={{ display: "grid", gap: 10 }}>
          {libraries.map((library) => {
            const selected = library.index === selectedIndex;
            return (
              <button
                type="button"
                key={`${library.index}:${library.path}`}
                className="secondary-button"
                aria-pressed={selected}
                onClick={() => setSelectedIndex(library.index)}
                style={{
                  minHeight: 68,
                  display: "grid",
                  gridTemplateColumns: "32px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                  borderColor: selected ? "rgba(89, 178, 255, .8)" : undefined,
                  boxShadow: selected ? "0 0 0 1px rgba(89, 178, 255, .24) inset" : undefined,
                }}
              >
                <HardDrive size={22} />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{library.label || library.path}</strong>
                  <small style={{ display: "block", opacity: .72, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {library.free_bytes == null ? "Espacio libre no disponible" : `${formatBytes(library.free_bytes)} libres`}
                  </small>
                </span>
                {selected ? <Check size={20} /> : null}
              </button>
            );
          })}
        </div>

        <div className="glass-actions-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="secondary-button" onClick={onCancel}><X size={16} /> Cancelar</button>
          <button type="button" className="primary-button" onClick={confirm}><HardDrive size={17} /> Descargar aquí</button>
        </div>
      </section>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 3 && value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
