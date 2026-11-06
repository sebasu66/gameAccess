import type { CatalogMode } from "./catalogMode";
import { useI18n, type TranslationKey } from "./i18n";

export const CATALOG_TABS: Array<{ id: CatalogMode; label: TranslationKey }> = [
  { id: "local", label: "tabOwn" },
  { id: "digital", label: "tabCatalog" },
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
          {t(tab.label)}
        </button>
      ))}
    </nav>
  );
}
