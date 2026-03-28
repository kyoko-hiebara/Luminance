/** Convert a linear value (0-1) to a logarithmic frequency position */
export function freqToX(freq: number, width: number, minFreq = 20, maxFreq = 20000): number {
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  const logFreq = Math.log10(Math.max(freq, minFreq));
  return ((logFreq - logMin) / (logMax - logMin)) * width;
}

/** Convert a dB value to a Y position on canvas */
export function dbToY(db: number, height: number, minDb = -90, maxDb = 0): number {
  const normalized = (db - minDb) / (maxDb - minDb);
  return height * (1 - Math.max(0, Math.min(1, normalized)));
}

/** Format frequency for display */
export function formatFreq(freq: number): string {
  if (freq >= 1000) {
    return `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k`;
  }
  return `${Math.round(freq)}`;
}

/** Format dB for display */
export function formatDb(db: number): string {
  if (db <= -90) return "-inf";
  return `${db.toFixed(1)}`;
}

/** Standard frequency markers for grid lines */
export const frequencyMarkers = [
  20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
];

/** Standard dB markers for grid lines */
export const dbMarkers = [-90, -72, -60, -48, -36, -24, -12, -6, 0];
