export type CatalogMode = "local" | "gameaccess" | "store";

const STORAGE_KEY = "gameaccess:catalog-mode";

export function getCatalogMode(): CatalogMode {
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === "gameaccess" || value === "store") return value;
  return "local";
}

export function setCatalogMode(mode: CatalogMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
}
