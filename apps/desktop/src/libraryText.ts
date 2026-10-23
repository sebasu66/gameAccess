/**
 * Text normalization shared by search and capability matching.
 *
 * Lives in its own module because both the capability matchers and the search
 * filters need it, and importing it from either of them would create a cycle.
 */

/** Lowercase, accent-insensitive form used for every comparison in the catalog. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}
