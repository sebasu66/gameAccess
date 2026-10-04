export type CatalogMode = "local" | "gameaccess" | "digital" | "store";

const STORAGE_KEY = "gameaccess:catalog-mode";

export function getCatalogMode(): CatalogMode {
  if (typeof localStorage === "undefined") return "local";
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === "gameaccess" || value === "digital") return value;
  return "local";
}

export function setCatalogMode(mode: CatalogMode): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, mode);
  }
}
