import { useRef, useEffect } from "react";
import { useAudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { getCanvasCtx, clearCanvas, glowText } from "@/lib/canvas";
import { colors } from "@/lib/colors";

interface Props {
  width: number;
  height: number;
}

const HISTORY_SIZE = 300;

/** Margins for labels and legend */
const MARGIN = { top: 4, right: 38, bottom: 18, left: 30 };

/** Map a dB value (-90 to 0) to an RGB color.
 *  Richer gradient with more visible mid-range:
 *  black -> deep purple -> blue -> cyan -> green -> yellow -> orange -> red -> white */
function dbToColor(db: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (db + 90) / 90));

  // Apply a slight gamma curve to brighten mid-levels
  const tAdjusted = Math.pow(t, 0.85);

  const stops: Array<{ pos: number; r: number; g: number; b: number }> = [
    { pos: 0.0, r: 5, g: 5, b: 10 },         // near-black
    { pos: 0.1, r: 30, g: 8, b: 60 },         // very dark purple
    { pos: 0.2, r: 65, g: 15, b: 120 },       // deep purple (brighter)
    { pos: 0.3, r: 40, g: 60, b: 200 },       // blue (brighter)
    { pos: 0.4, r: 10, g: 160, b: 220 },      // cyan
    { pos: 0.5, r: 20, g: 200, b: 120 },      // teal-green
    { pos: 0.6, r: 50, g: 210, b: 60 },       // green
    { pos: 0.7, r: 200, g: 210, b: 20 },      // yellow
    { pos: 0.8, r: 240, g: 150, b: 10 },      // orange
    { pos: 0.9, r: 240, g: 60, b: 50 },       // red
    { pos: 1.0, r: 255, g: 230, b: 230 },     // near-white
  ];

  // Find surrounding stops
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (tAdjusted >= stops[i].pos && tAdjusted <= stops[i + 1].pos) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  const range = upper.pos - lower.pos;
  const frac = range > 0 ? (tAdjusted - lower.pos) / range : 0;

  return [
    Math.round(lower.r + (upper.r - lower.r) * frac),
    Math.round(lower.g + (upper.g - lower.g) * frac),
    Math.round(lower.b + (upper.b - lower.b) * frac),
  ];
}

export function Spectrogram({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxCache = useRef({ w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null });
  const historyRef = useRef<number[][]>([]);
  const frameRef = useRef<number[] | null>(null);
  const frameCountRef = useRef(0);

  useAudioData("audio-data", (payload) => {
    frameRef.current = payload.spectrogram_frame;
  });

  // Reset history when size changes
  useEffect(() => {
    historyRef.current = [];
    frameCountRef.current = 0;
  }, [width, height]);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = getCanvasCtx(canvas, width, height, ctxCache.current);
    if (!ctx) return;

    clearCanvas(ctx, width, height, colors.bgPanel);

    // Append new frame to history
    const newFrame = frameRef.current;
    if (newFrame && newFrame.length > 0) {
      historyRef.current.push([...newFrame]);
      frameCountRef.current++;
      if (historyRef.current.length > HISTORY_SIZE) {
        historyRef.current.shift();
      }
    }

    const history = historyRef.current;
    if (history.length === 0) return;

    const numBands = history[0].length;
    if (numBands === 0) return;

    // Compute plot area
    const plotX = MARGIN.left;
    const plotY = MARGIN.top;
    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;

    if (plotW <= 0 || plotH <= 0) return;

    // Draw spectrogram using ImageData for the plot area
    const dpr = window.devicePixelRatio || 1;
    const imgW = Math.floor(plotW * dpr);
    const imgH = Math.floor(plotH * dpr);

    if (imgW <= 0 || imgH <= 0) return;

    const imageData = ctx.createImageData(imgW, imgH);
    const pixels = imageData.data;

    const colWidth = imgW / HISTORY_SIZE;
    const rowHeight = imgH / numBands;

    for (let col = 0; col < history.length; col++) {
      const frame = history[col];
      const xStart = Math.floor((HISTORY_SIZE - history.length + col) * colWidth);
      const xEnd = Math.floor((HISTORY_SIZE - history.length + col + 1) * colWidth);

      for (let band = 0; band < numBands; band++) {
        // Flip: low freq at bottom, high freq at top
        const yStart = Math.floor((numBands - 1 - band) * rowHeight);
        const yEnd = Math.floor((numBands - band) * rowHeight);

        const [r, g, b] = dbToColor(frame[band]);

        for (let y = yStart; y < yEnd && y < imgH; y++) {
          for (let x = xStart; x < xEnd && x < imgW; x++) {
            const idx = (y * imgW + x) * 4;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = 255;
          }
        }
      }
    }

    // Place ImageData at the plot area offset (in device pixels)
    ctx.putImageData(imageData, Math.floor(plotX * dpr), Math.floor(plotY * dpr));

    // Reset transform for overlay drawing (putImageData ignores transforms)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // --- Border around spectrogram plot area ---
    ctx.strokeStyle = colors.borderPanel;
    ctx.lineWidth = 1;
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // --- Frequency labels (left side) ---
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const freqLabels = [
      { label: "20k", pos: 0.0 },
      { label: "10k", pos: 0.15 },
      { label: "5k", pos: 0.3 },
      { label: "1k", pos: 0.55 },
      { label: "200", pos: 0.75 },
      { label: "20", pos: 0.97 },
    ];

    for (const { label, pos } of freqLabels) {
      const y = plotY + pos * plotH;

      // Dark background pill behind label for readability
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(10,10,15,0.75)";
      ctx.fillRect(plotX - textWidth - 8, y - 6, textWidth + 5, 12);

      glowText(ctx, label, plotX - 4, y);
    }

    // --- Time markers along the bottom ---
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const totalFrames = frameCountRef.current;
    const fps = 60;
    const totalSeconds = totalFrames / fps;
    const visibleSeconds = Math.min(totalSeconds, HISTORY_SIZE / fps);

    const timeMarkers = [
      { label: "now", frac: 1.0 },
      { label: "-1s", frac: 1.0 - 1 / visibleSeconds },
      { label: "-2s", frac: 1.0 - 2 / visibleSeconds },
      { label: "-3s", frac: 1.0 - 3 / visibleSeconds },
      { label: "-4s", frac: 1.0 - 4 / visibleSeconds },
      { label: "-5s", frac: 1.0 - 5 / visibleSeconds },
    ];

    for (const { label, frac } of timeMarkers) {
      if (frac < 0) continue;
      const x = plotX + frac * plotW;
      if (x < plotX || x > plotX + plotW) continue;

      glowText(ctx, label, x, plotY + plotH + 4);
    }

    // --- dB legend color bar (right side) ---
    const legendX = plotX + plotW + 6;
    const legendW = 8;
    const legendH = plotH;
    const legendY = plotY;

    // Draw the color bar
    const legendSteps = Math.floor(legendH);
    for (let i = 0; i < legendSteps; i++) {
      const frac = i / legendSteps; // 0 = top (0 dB), 1 = bottom (-90 dB)
      const db = -frac * 90;
      const [r, g, b] = dbToColor(db);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(legendX, legendY + i, legendW, 1);
    }

    // Border around legend bar
    ctx.strokeStyle = colors.borderPanel;
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendW, legendH);

    // dB labels on the legend
    ctx.font = "8px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const dbLabels = [
      { db: "0", frac: 0.0 },
      { db: "-30", frac: 0.33 },
      { db: "-60", frac: 0.67 },
      { db: "-90", frac: 1.0 },
    ];

    for (const { db, frac } of dbLabels) {
      const y = legendY + frac * legendH;
      glowText(ctx, db, legendX + legendW + 2, y);
    }
  });

  return <canvas ref={canvasRef} />;
}
