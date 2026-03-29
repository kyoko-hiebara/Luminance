import { useRef } from "react";
import { useAudioData, type AudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { getCanvasCtx, clearCanvas, glowText } from "@/lib/canvas";
import { colors } from "@/lib/colors";
import { dbToY, formatFreq, formatDb, frequencyMarkers, dbMarkers } from "@/lib/scales";

interface Props {
  width: number;
  height: number;
}

const LOG_MIN = Math.log10(20);
const LOG_MAX = Math.log10(20000);
const LOG_RANGE = LOG_MAX - LOG_MIN;

const PEAK_BANDS: [number, number][] = [
  [20, 200],
  [200, 1000],
  [1000, 20000],
];


function bandToFreq(i: number, numBands: number): number {
  const t = (i + 0.5) / numBands;
  return 20 * Math.pow(1000, t);
}

function freqToPlotX(freq: number, plotW: number): number {
  return ((Math.log10(Math.max(20, freq)) - LOG_MIN) / LOG_RANGE) * plotW;
}

function hsl(h: number, s: number, l: number, a: number): string {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

/** Plasma colormap: frequency position → hue
 *  Purple(270) → Magenta(310) → Pink(340) → Orange(20) → Yellow(55) */
function posToHue(normX: number): number {
  const stops = [
    [0, 270], [0.2, 290], [0.4, 320],
    [0.6, 345], [0.8, 20], [1.0, 55],
  ];
  const t = Math.max(0, Math.min(1, normX));
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) {
      const f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      let h0 = stops[i][1], h1 = stops[i + 1][1];
      // Handle hue wrap (e.g., 345 → 20 should go through 360/0)
      if (h1 < h0 - 180) h1 += 360;
      if (h0 < h1 - 180) h0 += 360;
      return ((h0 + (h1 - h0) * f) + 360) % 360;
    }
  }
  return 55;
}

function freqToHue(freq: number): number {
  const normX = (Math.log10(Math.max(20, freq)) - LOG_MIN) / LOG_RANGE;
  return posToHue(normX);
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  textColor: string,
  canvasW: number
) {
  ctx.font = "bold 9px monospace";
  const m = ctx.measureText(text);
  const pw = m.width + 10;
  const ph = 16;
  const px = Math.max(pw / 2 + 2, Math.min(x, canvasW - pw / 2 - 2));
  const py = Math.max(ph + 4, y);

  ctx.fillStyle = "rgba(10,10,20,0.92)";
  ctx.beginPath();
  ctx.roundRect(px - pw / 2, py - ph, pw, ph, 4);
  ctx.fill();
  ctx.strokeStyle = textColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px - pw / 2, py - ph, pw, ph, 4);
  ctx.stroke();

  ctx.fillStyle = "rgba(10,10,20,0.92)";
  ctx.beginPath();
  ctx.moveTo(px - 4, py);
  ctx.lineTo(px + 4, py);
  ctx.lineTo(px, py + 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = textColor;
  ctx.beginPath();
  ctx.moveTo(px - 4, py);
  ctx.lineTo(px, py + 4);
  ctx.lineTo(px + 4, py);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 4;
  ctx.shadowColor = textColor;
  ctx.fillStyle = textColor;
  ctx.fillText(text, px, py - ph / 2);
  ctx.shadowBlur = 0;
  ctx.textBaseline = "alphabetic";
}

const PEAK_EMA_ALPHA = 0.025;

interface SmoothedPeak {
  freq: number;
  db: number;
  rawFreq: number;
  rawDb: number;
}

/** Build the smooth spectrum curve path (reusable for fill + clip) */
function buildCurvePath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  bottomY: number
) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.lineTo(last.x, bottomY);
  ctx.lineTo(points[0].x, bottomY);
  ctx.closePath();
}

export function Spectrum({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxCache = useRef({ w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null });
  const dataRef = useRef<AudioData["spectrum"] | null>(null);
  const baseGradCache = useRef<{ w: number; fill: CanvasGradient | null }>({ w: 0, fill: null });
  const smoothedPeaks = useRef<SmoothedPeak[]>(
    PEAK_BANDS.map(() => ({ freq: 0, db: -90, rawFreq: 0, rawDb: -90 }))
  );


  useAudioData("audio-data", (payload) => {
    dataRef.current = payload.spectrum;
  });

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = getCanvasCtx(canvas, width, height, ctxCache.current);
    if (!ctx) return;

    clearCanvas(ctx, width, height, colors.bgPanel);

    const padding = { top: 12, right: 12, bottom: 24, left: 36 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    // Grid
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    ctx.font = "9px monospace";

    for (const db of dbMarkers) {
      const y = padding.top + dbToY(db, plotH);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotW, y);
      ctx.stroke();
      ctx.textAlign = "right";
      glowText(ctx, formatDb(db), padding.left - 4, y + 3);
    }
    for (const freq of frequencyMarkers) {
      const x = padding.left + freqToPlotX(freq, plotW);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotH);
      ctx.stroke();
      ctx.textAlign = "center";
      glowText(ctx, formatFreq(freq), x, height - 4);
    }

    const spectrum = dataRef.current;
    if (!spectrum || spectrum.magnitudes.length === 0) return;

    const numBands = spectrum.magnitudes.length;
    const bottomY = padding.top + plotH;

    // Build point array
    const points: { x: number; y: number; freq: number; db: number }[] = [];
    for (let i = 0; i < numBands; i++) {
      const freq = bandToFreq(i, numBands);
      const x = padding.left + freqToPlotX(freq, plotW);
      const db = spectrum.magnitudes[i];
      const y = padding.top + dbToY(db, plotH);
      points.push({ x, y, freq, db });
    }

    // --- Per-frame dynamic range from actual spectrum magnitudes ---
    // Sort current frame's band magnitudes to get percentiles
    const liveMags = spectrum.magnitudes.filter((d) => d > -85);
    liveMags.sort((a, b) => a - b);
    const dynFloor = liveMags.length > 2 ? liveMags[Math.floor(liveMags.length * 0.15)] : -60;
    const dynCeil = liveMags.length > 2 ? liveMags[Math.floor(liveMags.length * 0.85)] : -10;
    const dynRange = Math.max(4, dynCeil - dynFloor);

    // --- 1. Rainbow fill (fixed brightness, like spectrogram) ---
    const gc = baseGradCache.current;
    if (gc.w !== plotW || gc.fill === null) {
      // Vertical gradient: dark bottom → warm cream top (matching line color)
      const g = ctx.createLinearGradient(0, padding.top + plotH, 0, padding.top);
      g.addColorStop(0, "rgba(91,2,163,0.25)");      // #5b02a3 purple (quiet base)
      g.addColorStop(0.25, "rgba(204,71,120,0.45)");  // #cc4778 pink
      g.addColorStop(0.5, "rgba(237,121,83,0.6)");    // #ed7953 orange
      g.addColorStop(0.75, "rgba(237,200,176,0.72)");  // #edc8b0 warm cream
      g.addColorStop(1, "rgba(245,224,208,0.82)");     // #f5e0d0 light cream
      gc.fill = g;
      gc.w = plotW;
    }

    buildCurvePath(ctx, points, bottomY);
    ctx.fillStyle = gc.fill!;
    ctx.fill();

    // --- 2. Sparkle dots (ALL bands, +15dB above curve, size = loudness) ---
    ctx.save();
    for (let i = 0; i < numBands; i++) {
      const db = points[i].db;
      if (db < -80) continue;
      const boost = Math.max(0, Math.min(1, (db - dynFloor) / dynRange));

      const x = points[i].x;
      const nextX = i < numBands - 1 ? points[i + 1].x : padding.left + plotW;
      const bandW = nextX - x;
      const hue = freqToHue(points[i].freq);
      const sparkleY = padding.top + dbToY(Math.min(0, db + 15), plotH);
      const r = 1 + boost * 4.5;

      ctx.shadowColor = hsl(hue, 100, 65, 1);
      ctx.shadowBlur = 6 + boost * 30;
      ctx.fillStyle = hsl(hue, 90, 60 + boost * 20, 0.3 + boost * 0.7);
      ctx.beginPath();
      ctx.arc(x + bandW / 2, sparkleY, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    // --- 3. Curve line with glow (shadowBlur on the line itself → smooth bloom) ---
    const last = points[points.length - 1];

    // Wide soft colored glow (follows the curve smoothly)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    }
    ctx.lineTo(last.x, last.y);
    ctx.shadowColor = "rgba(237,200,176,0.7)";
    ctx.shadowBlur = 28;
    ctx.strokeStyle = "rgba(245,224,208,0.35)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    // Crisp main line (warm cream, matching Oscilloscope)
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    }
    ctx.lineTo(last.x, last.y);
    ctx.strokeStyle = "#edc8b0";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // --- 5. Peak hold line ---
    if (spectrum.peaks.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < numBands; i++) {
        const freq = bandToFreq(i, numBands);
        const x = padding.left + freqToPlotX(freq, plotW);
        const db = spectrum.peaks[i];
        const y = padding.top + dbToY(db, plotH);
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevFreq = bandToFreq(i - 1, numBands);
          const prevX = padding.left + freqToPlotX(prevFreq, plotW);
          const prevY = padding.top + dbToY(spectrum.peaks[i - 1], plotH);
          ctx.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
        }
      }
      ctx.lineTo(
        padding.left + freqToPlotX(bandToFreq(numBands - 1, numBands), plotW),
        padding.top + dbToY(spectrum.peaks[numBands - 1], plotH)
      );
      ctx.strokeStyle = colors.peakHold;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- 6. Peak frequency bubbles (EMA smoothed, rainbow-colored) ---
    const sp = smoothedPeaks.current;
    for (let b = 0; b < PEAK_BANDS.length; b++) {
      const [loFreq, hiFreq] = PEAK_BANDS[b];
      let maxDb = -Infinity;
      let maxIdx = -1;

      for (let i = 0; i < numBands; i++) {
        const freq = bandToFreq(i, numBands);
        if (freq >= loFreq && freq <= hiFreq && spectrum.magnitudes[i] > maxDb) {
          maxDb = spectrum.magnitudes[i];
          maxIdx = i;
        }
      }

      if (maxIdx < 0 || maxDb < -80) continue;

      const rawFreq = bandToFreq(maxIdx, numBands);
      const p = sp[b];
      const a = PEAK_EMA_ALPHA;

      if (p.freq < 1) {
        p.freq = rawFreq;
        p.db = maxDb;
      } else {
        p.freq = Math.pow(10, Math.log10(p.freq) * (1 - a) + Math.log10(rawFreq) * a);
        p.db = p.db * (1 - a) + maxDb * a;
      }
      p.rawFreq = rawFreq;
      p.rawDb = maxDb;

      const px = padding.left + freqToPlotX(p.freq, plotW);
      const py = padding.top + dbToY(p.db, plotH);
      const hue = freqToHue(p.freq);
      const bubbleColor = hsl(hue, 90, 68, 1);

      ctx.save();
      ctx.shadowColor = bubbleColor;
      ctx.shadowBlur = 10;
      ctx.fillStyle = bubbleColor;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      drawBubble(ctx, px, py - 8, `${formatFreq(p.freq)}Hz`, bubbleColor, width);
    }
  });

  return <canvas ref={canvasRef} />;
}
