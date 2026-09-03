import type { CatalogMode } from "./catalogMode";

const tabs: Array<{ id: CatalogMode; label: string }> = [
  { id: "local", label: "Propios" },
  { id: "gameaccess", label: "GameAccess" },
  { id: "store", label: "Store" },
];

export default function CatalogTabs({ mode, onChange }: { mode: CatalogMode; onChange: (mode: CatalogMode) => void }) {
  return (
    <nav className="catalog-tabs" aria-label="Origen del catálogo">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={mode === tab.id ? "active" : ""}
          aria-current={mode === tab.id ? "page" : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
