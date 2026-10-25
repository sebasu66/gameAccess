/**
 * The "how recent" slider is not linear: the past moves a year per step, the
 * present a month per step, so recent releases can be told apart finely.
 * The leftmost step means no limit; the rightmost is the last month.
 */
const DAYS_PER_MONTH = 30;
const OLDEST_YEARS = 15;
/** Slider length; the last 12 months take the final 30 % of it. */
export const RELEASE_TRACK = 1000;
const MONTHS_SHARE = 0.3;

/** Steps from the far past (index 0 = any date) to the last month. */
export const RELEASE_STEPS: (number | undefined)[] = [
  undefined,
  ...Array.from({ length: OLDEST_YEARS - 1 }, (_, i) => (OLDEST_YEARS - i) * 365),
  365,
  ...Array.from({ length: 11 }, (_, i) => (11 - i) * DAYS_PER_MONTH),
];

export const RELEASE_LAST_INDEX = RELEASE_STEPS.length - 1;

/** Where each step sits on the slider: years share 70 %, the last 12 months 30 %. */
const ONE_YEAR_INDEX = OLDEST_YEARS; // any + 14 older years, then the 1-year mark
export const RELEASE_POSITIONS: number[] = RELEASE_STEPS.map((_, i) => {
  const yearsEnd = RELEASE_TRACK * (1 - MONTHS_SHARE);
  if (i <= ONE_YEAR_INDEX) return Math.round((yearsEnd * i) / ONE_YEAR_INDEX);
  return Math.round(yearsEnd + ((RELEASE_TRACK - yearsEnd) * (i - ONE_YEAR_INDEX)) / (RELEASE_LAST_INDEX - ONE_YEAR_INDEX));
});

/** The step nearest to a slider position. */
export function releaseIndexAt(position: number): number {
  let best = 0;
  for (let i = 1; i < RELEASE_POSITIONS.length; i++) {
    if (Math.abs(RELEASE_POSITIONS[i] - position) < Math.abs(RELEASE_POSITIONS[best] - position)) best = i;
  }
  return best;
}

/** The step closest to a number of days (undefined = any date). */
export function releaseIndexFor(days: number | undefined): number {
  if (days === undefined) return 0;
  let best = 1;
  for (let i = 1; i < RELEASE_STEPS.length; i++) {
    if (Math.abs((RELEASE_STEPS[i] as number) - days) < Math.abs((RELEASE_STEPS[best] as number) - days)) best = i;
  }
  return best;
}

/** "en el último año", "en los últimos 3 meses", or null for no limit. */
export function releaseWords(days: number | undefined): string | null {
  if (days === undefined) return null;
  if (days >= 365) {
    const years = Math.round(days / 365);
    return years === 1 ? "en el último año" : `en los últimos ${years} años`;
  }
  const months = Math.max(1, Math.round(days / DAYS_PER_MONTH));
  return months === 1 ? "en el último mes" : `en los últimos ${months} meses`;
}

/** Short label for the slider bubble: "cualquiera", "30 años", "1 año", "6 meses". */
export function releaseShort(days: number | undefined): string {
  if (days === undefined) return "cualquiera";
  if (days >= 365) { const y = Math.round(days / 365); return y === 1 ? "1 año" : `${y} años`; }
  const m = Math.max(1, Math.round(days / DAYS_PER_MONTH));
  return m === 1 ? "1 mes" : `${m} meses`;
}
