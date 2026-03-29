export const colors = {
  bgPrimary: "#091834",
  bgPanel: "#0e2245",
  borderPanel: "#2D559F",
  grid: "#1A3567",
  textPrimary: "#EBEEFC",
  textDim: "#7F9EED",
  accent: "#C33F45",
  peakHold: "#E2B0A5",
  levelOk: "#A3D9D9",
  levelWarn: "#D89F58",
  levelOver: "#95292D",
} as const;

// Spectrum gradient stops (bottom to top / low to high dB)
// Plasma → warm cream
export const spectrumGradientStops = [
  { offset: 0.0, color: "#0d0887" },
  { offset: 0.15, color: "#5b02a3" },
  { offset: 0.3, color: "#9c179e" },
  { offset: 0.45, color: "#cc4778" },
  { offset: 0.6, color: "#ed7953" },
  { offset: 0.75, color: "#fbb61a" },
  { offset: 0.9, color: "#edc8b0" },
  { offset: 1.0, color: "#f5e0d0" },
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
