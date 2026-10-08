export const DOWNLOAD_ORB_SIZE = 100;
export type OrbPosition = { x: number; y: number };
export function clampOrb(position: OrbPosition, width: number, height: number): OrbPosition {
  return {x:Math.max(12, Math.min(position.x, width - DOWNLOAD_ORB_SIZE - 12)),
    y:Math.max(80, Math.min(position.y, Math.max(80, height - DOWNLOAD_ORB_SIZE - 76)))};
}
export function progressSegments(progress: number, cells = 48): number {
  return Math.ceil(Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0)) / 100 * cells);
}
