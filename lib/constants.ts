/** Openers people commonly use; the default for simulated players. */
export const POPULAR_OPENERS = ["crane", "slate", "adieu", "stare", "audio", "raise", "arise", "trace", "crate", "salet"];

/** Format a probability-like share as a short percentage. */
export function formatShare(x: number): string {
  if (x >= 0.995) return "≈100%";
  if (x < 0.001) return "<0.1%";
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
}
