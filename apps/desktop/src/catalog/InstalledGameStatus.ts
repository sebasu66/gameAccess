export type InstalledAppIdLoader = () => Promise<number[]>;

/**
 * Shared installation utility for every catalog.
 *
 * Installation is disk/runtime state only. It never grants ownership, Family
 * access, a GameAccess license, or catalog membership.
 */
export class InstalledGameStatus {
  constructor(private readonly loadInstalledAppIds: InstalledAppIdLoader) {}

  async load(): Promise<number[]> {
    const ids = await this.loadInstalledAppIds();
    return [...new Set(ids.filter((appId) => Number.isInteger(appId) && appId > 0))]
      .sort((left, right) => left - right);
  }

  static has(appId: number | null | undefined, installed: ReadonlySet<number>): boolean {
    return Boolean(appId && installed.has(appId));
  }
}
