export type CatalogMode = "local" | "digital" | "store";

const STORAGE_KEY = "gameaccess:catalog-mode";

export function getCatalogMode(): CatalogMode {
  if (typeof localStorage === "undefined") return "digital";
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === "local" || value === "store") return value;
  return "digital";
}

export function setCatalogMode(mode: CatalogMode): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, mode);
  }
}
