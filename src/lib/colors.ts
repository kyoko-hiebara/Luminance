export const colors = {
  bgPrimary: "#0e0e18",
  bgPanel: "#1c1c2e",
  borderPanel: "#32325a",
  grid: "#222238",
  textPrimary: "#ededf4",
  textDim: "#9a9ab4",
  accent: "#8b5cf6",
  peakHold: "#f472b6",
  levelOk: "#22c55e",
  levelWarn: "#eab308",
  levelOver: "#ef4444",
} as const;

// Spectrum gradient stops (bottom to top / low to high dB)
export const spectrumGradientStops = [
  { offset: 0.0, color: "#1a1a4e" },
  { offset: 0.2, color: "#2563eb" },
  { offset: 0.4, color: "#06b6d4" },
  { offset: 0.6, color: "#22c55e" },
  { offset: 0.8, color: "#eab308" },
  { offset: 1.0, color: "#ef4444" },
] as const;

export function createSpectrumGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  yBottom: number,
  yTop: number
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x, yBottom, x, yTop);
  for (const stop of spectrumGradientStops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  return gradient;
}
