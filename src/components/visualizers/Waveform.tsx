import { useRef, useState, useCallback } from "react";
import { useAudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useFileAnalysis } from "@/hooks/useFileAnalysis";
import { useBpm } from "@/hooks/useBpm";
import { getCanvasCtx, clearCanvas, glowText } from "@/lib/canvas";
import { colors } from "@/lib/colors";
import { NeonSlider } from "@/components/NeonSlider";

interface Props {
  width: number;
  height: number;
}

const SAMPLES_PER_FRAME = 512;
const FPS = 60;
const SAMPLES_PER_SEC = SAMPLES_PER_FRAME * FPS;
const MAX_SECONDS = 30;
const MAX_HISTORY = SAMPLES_PER_SEC * MAX_SECONDS;
const MIN_SECONDS = 0.5;
const MAX_FRAMES = 60 * 30; // 1800 frames = 30s at 60fps
const DEFAULT_DB_FLOOR = -48;
const DEFAULT_DB_CEIL = 0;

type Mode = "lr" | "ms";



// Log slider mapping
function sliderToSeconds(v: number): number {
  return MIN_SECONDS * Math.pow(MAX_SECONDS / MIN_SECONDS, v);
}
function secondsToSlider(s: number): number {
  return Math.log(s / MIN_SECONDS) / Math.log(MAX_SECONDS / MIN_SECONDS);
}
function formatViewTime(s: number): string {
  if (s < 1) return `${s.toFixed(1)}s`;
  if (s < 10) return `${s.toFixed(1)}s`;
  return `${Math.round(s)}s`;
}

export function Waveform({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxCache = useRef({ w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null });
  const historyL = useRef<Float32Array>(new Float32Array(MAX_HISTORY));
  const historyR = useRef<Float32Array>(new Float32Array(MAX_HISTORY));
  const writePos = useRef(0);
  const totalWritten = useRef(0);

  // Per-channel band energy history (L, R, and Side separate)
  const bandHistL = useRef([new Float32Array(MAX_FRAMES), new Float32Array(MAX_FRAMES), new Float32Array(MAX_FRAMES)]);
  const bandHistR = useRef([new Float32Array(MAX_FRAMES), new Float32Array(MAX_FRAMES), new Float32Array(MAX_FRAMES)]);
  const bandHistS = useRef([new Float32Array(MAX_FRAMES), new Float32Array(MAX_FRAMES), new Float32Array(MAX_FRAMES)]);
  const frameWritePos = useRef(0);
  const totalFrames = useRef(0);

  // Use refs for values read in the animation loop to avoid closure staleness
  const viewSecondsRef = useRef(5);
  const [viewSeconds, setViewSeconds] = useState(5);
  const [mode, setMode] = useState<Mode>("lr");
  const modeRef = useRef<Mode>("lr");

  const dbFloorRef = useRef(DEFAULT_DB_FLOOR);
  const dbCeilRef = useRef(DEFAULT_DB_CEIL);

  const { bpmRef } = useBpm();

  useFileAnalysis((data) => {
    if (!data) {
      // Reset to defaults for mic mode
      dbFloorRef.current = DEFAULT_DB_FLOOR;
      dbCeilRef.current = DEFAULT_DB_CEIL;
      return;
    }
    // Auto-compute dB range from density percentiles
    const p10Amp = data.density_p10 * 0.5;
    const p90Amp = data.density_p90 * 0.5;
    const dbP10 = p10Amp > 0 ? 20 * Math.log10(p10Amp) : -60;
    const dbP90 = p90Amp > 0 ? 20 * Math.log10(p90Amp) : 0;
    // Floor: a bit below P10, ceil: a bit above P90
    dbFloorRef.current = Math.max(-60, Math.min(-6, dbP10 - 6));
    dbCeilRef.current = Math.min(0, Math.max(dbP90 + 3, dbFloorRef.current + 12));
  });

  useAudioData("audio-data", (payload) => {
    const { samples_l, samples_r, band_l, band_r, band_s } = payload.waveform;
    const len = samples_l.length;
    if (len === 0) return;

    const bufL = historyL.current;
    const bufR = historyR.current;
    let pos = writePos.current;

    for (let i = 0; i < len; i++) {
      bufL[pos] = samples_l[i];
      bufR[pos] = samples_r[i];
      pos = (pos + 1) % MAX_HISTORY;
    }

    writePos.current = pos;
    totalWritten.current += len;

    // Store per-channel band energies
    const fwp = frameWritePos.current;
    for (let b = 0; b < 3; b++) {
      bandHistL.current[b][fwp] = band_l[b];
      bandHistR.current[b][fwp] = band_r[b];
      bandHistS.current[b][fwp] = band_s[b];
    }
    frameWritePos.current = (fwp + 1) % MAX_FRAMES;
    totalFrames.current++;
  });

  const controlH = 24;
  const canvasHeight = height - controlH;

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasHeight <= 0 || width <= 0) return;

    const ctx = getCanvasCtx(canvas, width, canvasHeight, ctxCache.current);
    if (!ctx) return;

    clearCanvas(ctx, width, canvasHeight, colors.bgPanel);

    const halfH = Math.floor(canvasHeight / 2);
    const chH = halfH - 1;
    const isMS = modeRef.current === "ms";
    const vs = viewSecondsRef.current;

    // Divider
    ctx.strokeStyle = colors.borderPanel;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(width, halfH);
    ctx.stroke();

    // Zero lines
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    const cy1 = Math.floor(halfH * 0.5);
    const cy2 = halfH + Math.floor(halfH * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, cy1);
    ctx.lineTo(width, cy1);
    ctx.moveTo(0, cy2);
    ctx.lineTo(width, cy2);
    ctx.stroke();

    // Labels
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    glowText(ctx, isMS ? "M" : "L", 4, 12);
    glowText(ctx, isMS ? "S" : "R", 4, halfH + 12);

    const viewSamples = Math.min(
      Math.round(vs * SAMPLES_PER_SEC),
      totalWritten.current,
      MAX_HISTORY
    );
    if (viewSamples < 2) return;

    const bufL = historyL.current;
    const bufR = historyR.current;
    const wp = writePos.current;
    const startIdx = (wp - viewSamples + MAX_HISTORY) % MAX_HISTORY;
    const samplesPerPixel = viewSamples / width;

    const maxAmp = chH * 0.45;

    // Pre-compute M/S buffers if needed
    let ch1Buf: Float32Array | null = null;
    let ch2Buf: Float32Array | null = null;
    if (isMS) {
      ch1Buf = new Float32Array(viewSamples);
      ch2Buf = new Float32Array(viewSamples);
      for (let s = 0; s < viewSamples; s++) {
        const idx = (startIdx + s) % MAX_HISTORY;
        const l = bufL[idx];
        const r = bufR[idx];
        ch1Buf[s] = (l + r) * 0.5;
        ch2Buf[s] = (l - r) * 0.5;
      }
    }

    // Precompute per-frame hue arrays for L, R, Mid, Side
    const viewFrames = Math.min(totalFrames.current, MAX_FRAMES);
    const fwp = frameWritePos.current;
    const framesInView = Math.max(1, Math.ceil(viewSamples / SAMPLES_PER_FRAME));

    // Plasma hue mapping: Purple(270) → Magenta(310) → Pink(340) → Orange(20) → Yellow(55)
    const balToHue = (lo: number, mi: number, hi: number, exp: number) => {
      const tot = lo + mi + hi;
      if (tot < 0.001) return 270; // purple at silence
      const bal = (mi * 0.5 + hi) / tot;
      const t = Math.pow(Math.max(0.001, bal), exp);
      const stops = [
        [0, 270], [0.2, 290], [0.4, 320],
        [0.6, 345], [0.8, 20], [1.0, 55],
      ];
      for (let i = 0; i < stops.length - 1; i++) {
        if (t <= stops[i + 1][0]) {
          const f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
          let h0 = stops[i][1], h1 = stops[i + 1][1];
          if (h1 < h0 - 180) h1 += 360;
          if (h0 < h1 - 180) h0 += 360;
          return ((h0 + (h1 - h0) * f) + 360) % 360;
        }
      }
      return 55;
    };

    const hueL = new Float32Array(framesInView);
    const hueR = new Float32Array(framesInView);
    const hueM = new Float32Array(framesInView);
    const hueS = new Float32Array(framesInView);
    for (let f = 0; f < framesInView && f < viewFrames; f++) {
      const hi = ((fwp - framesInView + f) % MAX_FRAMES + MAX_FRAMES) % MAX_FRAMES;
      const bL = bandHistL.current;
      const bR = bandHistR.current;
      const bS = bandHistS.current;
      hueL[f] = balToHue(bL[0][hi], bL[1][hi], bL[2][hi], 0.35);
      hueR[f] = balToHue(bR[0][hi], bR[1][hi], bR[2][hi], 0.35);
      hueM[f] = balToHue(
        (bL[0][hi] + bR[0][hi]) * 0.5,
        (bL[1][hi] + bR[1][hi]) * 0.5,
        (bL[2][hi] + bR[2][hi]) * 0.5,
        0.35
      );
      // Side: exponent 0.7 → high balance values (0.6-0.9) spread across wider hue range
      // instead of all cramming into 260-300 (purple)
      hueS[f] = balToHue(bS[0][hi], bS[1][hi], bS[2][hi], 0.7);
    }

    const drawChannel = (centerY: number, amp: number, chIdx: 0 | 1) => {
      // In M/S mode: ch0=Mid uses avg(L,R) hue, ch1=Side uses diff-weighted hue
      for (let px = 0; px < width; px++) {
        const sStart = Math.floor(px * samplesPerPixel);
        const sEnd = Math.max(sStart + 1, Math.floor((px + 1) * samplesPerPixel));
        let min = Infinity;
        let max = -Infinity;

        if (isMS) {
          const buf = chIdx === 0 ? ch1Buf! : ch2Buf!;
          for (let s = sStart; s < sEnd; s++) {
            const v = buf[s];
            if (v < min) min = v;
            if (v > max) max = v;
          }
        } else {
          const buf = chIdx === 0 ? bufL : bufR;
          for (let s = sStart; s < sEnd; s++) {
            const v = buf[(startIdx + s) % MAX_HISTORY];
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        if (min === Infinity) continue;

        // Frame index for this column
        const sampleMid = Math.floor((sStart + sEnd) * 0.5);
        const frameOffset = Math.min(Math.floor(sampleMid / SAMPLES_PER_FRAME), framesInView - 1);

        // Pick hue: L/R mode → per-channel FFT, M/S mode → Mid FFT or Side FFT
        const hue = isMS
          ? (chIdx === 0 ? hueM[frameOffset] : hueS[frameOffset])
          : (chIdx === 0 ? hueL[frameOffset] : hueR[frameOffset]);

        const density = max - min;
        const alpha = Math.min(0.95, density * 0.85) + 0.05;

        const yTop = centerY - max * amp;
        const yBot = centerY - min * amp;
        const barH = Math.max(1, yBot - yTop);

        const color = `hsla(${hue},92%,58%,`;

        // Glow
        ctx.fillStyle = color + `${alpha * 0.3})`;
        ctx.fillRect(px - 0.5, yTop - 1.5, 2, barH + 3);

        // Main bar
        ctx.fillStyle = color + `${alpha})`;
        ctx.fillRect(px, yTop, 1, barH);
      }
    };

    drawChannel(cy1, maxAmp, 0);
    drawChannel(cy2, maxAmp, 1);

    // Beat-synced grid + time markers
    const currentBpm = bpmRef.current;
    const beatSec = 60 / currentBpm;
    ctx.font = "8px monospace";
    ctx.textAlign = "center";

    // Draw beat lines across the visible time window
    // viewSeconds is the total visible time; beats count backward from "now" (right edge)
    const totalBeats = vs / beatSec;
    const barSec = beatSec * 4;

    if (totalBeats <= 64) {
      // Show individual beats (and bars with thicker lines)
      for (let b = 1; b < totalBeats; b++) {
        const tFromStart = b * beatSec;
        const x = (tFromStart / vs) * width;
        const isBar = b % 4 === 0;

        ctx.strokeStyle = isBar ? "rgba(60,60,100,0.9)" : "rgba(40,40,70,0.5)";
        ctx.lineWidth = isBar ? 0.8 : 0.4;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();

        // Label bars
        if (isBar) {
          const barsAgo = Math.round((vs - tFromStart) / barSec);
          glowText(ctx, `-${barsAgo}bar`, x, canvasHeight - 3);
        }
      }
    } else {
      // Too many beats — show only bars
      for (let bar = 1; bar * barSec < vs; bar++) {
        const tFromStart = bar * barSec;
        const x = (tFromStart / vs) * width;
        ctx.strokeStyle = "rgba(50,50,90,0.8)";
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();

        const barsAgo = Math.round((vs - tFromStart) / barSec);
        if (barsAgo > 0) glowText(ctx, `-${barsAgo}`, x, canvasHeight - 3);
      }
    }

    // Always show seconds at the bottom-right
    ctx.textAlign = "right";
    glowText(ctx, `${vs.toFixed(1)}s`, width - 4, canvasHeight - 3);
  });

  const handleSlider = useCallback((v: number) => {
    const secs = sliderToSeconds(v);
    viewSecondsRef.current = secs;
    setViewSeconds(secs);
  }, []);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === "lr" ? "ms" : "lr";
      modeRef.current = next;
      return next;
    });
  }, []);

  const sliderVal = secondsToSlider(viewSeconds);

  return (
    <div className="flex flex-col" style={{ height: "100%" }}>
      <canvas ref={canvasRef} style={{ flex: 1, minHeight: 0 }} />
      <div
        className="flex items-center gap-2 px-2"
        style={{
          height: controlH,
          background: colors.bgPanel,
          borderTop: `1px solid ${colors.borderPanel}`,
        }}
      >
        <button
          onClick={toggleMode}
          style={{
            fontSize: 9,
            fontFamily: "monospace",
            padding: "1px 6px",
            borderRadius: 3,
            border: `1px solid ${colors.borderPanel}`,
            background: mode === "ms" ? `${colors.accent}33` : "transparent",
            color: mode === "ms" ? colors.accent : colors.textDim,
            cursor: "pointer",
            lineHeight: "14px",
          }}
        >
          {mode === "lr" ? "L/R" : "M/S"}
        </button>
        <span
          style={{
            fontSize: 9,
            fontFamily: "monospace",
            color: colors.textDim,
            minWidth: 30,
            textAlign: "right",
          }}
        >
          {formatViewTime(viewSeconds)}
        </span>
        <NeonSlider value={sliderVal} onChange={handleSlider} />
      </div>
    </div>
  );
}
