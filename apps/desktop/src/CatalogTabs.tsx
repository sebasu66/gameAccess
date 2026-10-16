import type { CatalogMode } from "./catalogMode";
import { useI18n } from "./i18n";

export const CATALOG_TABS: Array<{ id: CatalogMode; label: string }> = [
  { id: "local", label: "Propios" },
  { id: "digital", label: "Catálogo" },
];

export default function CatalogTabs({ mode, onChange }: { mode: CatalogMode; onChange: (mode: CatalogMode) => void }) {
  const { t } = useI18n();
  return (
    <nav className="catalog-tabs" aria-label={t("uiOrigenDelCatalogo")}>
      {CATALOG_TABS.map((tab) => (
        <button
          type="button"
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
