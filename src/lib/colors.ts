export const colors = {
  bgPrimary: "#091834",
  bgPanel: "#162121",
  borderPanel: "#2E4141",
  grid: "#496464",
  textPrimary: "#D8F7F7",
  textDim: "#84B0B0",
  accent: "#C33F45",
  peakHold: "#E2B0A5",
  levelOk: "#A3D9D9",
  levelWarn: "#D89F58",
  levelOver: "#95292D",
} as const;

// Spectrum gradient stops (bottom to top / low to high dB)
export const spectrumGradientStops = [
  { offset: 0.0, color: "#1A3567" },
  { offset: 0.2, color: "#176571" },
  { offset: 0.4, color: "#A3D9D9" },
  { offset: 0.6, color: "#D89F58" },
  { offset: 0.8, color: "#C33F45" },
  { offset: 1.0, color: "#95292D" },
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
