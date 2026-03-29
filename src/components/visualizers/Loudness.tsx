import { useRef, useState, useCallback } from "react";
import { useAudioData, type AudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useFileAnalysis } from "@/hooks/useFileAnalysis";
import { getCanvasCtx, clearCanvas, glowText } from "@/lib/canvas";
import { colors } from "@/lib/colors";
import { NeonRangeSlider } from "@/components/NeonSlider";

interface Props {
  width: number;
  height: number;
}

const ABS_MIN = -60;
const ABS_MAX = 0;
const ABS_RANGE = ABS_MAX - ABS_MIN;
const DEFAULT_FLOOR = -24;
const DEFAULT_CEIL = 0;
const REFERENCE_LUFS = -14;
const SEGMENT_COUNT = 30;

function lufsToNorm(lufs: number, floor: number, ceil: number): number {
  return Math.max(0, Math.min(1, (lufs - floor) / (ceil - floor)));
}

function lufsColor(lufs: number): string {
  if (lufs > REFERENCE_LUFS) return colors.levelOver;
  if (lufs > -18) return colors.levelWarn;
  return colors.levelOk;
}

function segmentLufsColor(i: number, floor: number, ceil: number): string {
  const lufs = floor + (i / SEGMENT_COUNT) * (ceil - floor);
  if (lufs > REFERENCE_LUFS) return colors.levelOver;
  if (lufs > -18) return colors.levelWarn;
  return colors.levelOk;
}

function formatLufs(lufs: number, floor: number): string {
  if (lufs <= floor) return "-inf";
  return lufs.toFixed(1);
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  textColor: string,
  borderColor: string
) {
  ctx.font = "bold 9px monospace";
  const metrics = ctx.measureText(text);
  const pw = metrics.width + 8;
  const ph = 14;
  const canvasW = ctx.canvas.width / (window.devicePixelRatio || 1);
  const px = Math.max(pw / 2, Math.min(x, canvasW - pw / 2));
  const py = Math.max(ph, y);

  ctx.fillStyle = "rgba(12,12,26,0.92)";
  ctx.beginPath();
  ctx.roundRect(px - pw / 2, py - ph, pw, ph, 3);
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px - pw / 2, py - ph, pw, ph, 3);
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

function lufsToSlider(v: number): number {
  return (v - ABS_MIN) / ABS_RANGE;
}
function sliderToLufs(v: number): number {
  return Math.round(ABS_MIN + v * ABS_RANGE);
}

export function Loudness({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxCache = useRef({ w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null });
  const dataRef = useRef<AudioData["loudness"] | null>(null);

  const [lufsFloor, setLufsFloor] = useState(DEFAULT_FLOOR);
  const [lufsCeil, setLufsCeil] = useState(DEFAULT_CEIL);
  const floorRef = useRef(DEFAULT_FLOOR);
  const ceilRef = useRef(DEFAULT_CEIL);

  useFileAnalysis((data) => {
    if (!data) {
      floorRef.current = DEFAULT_FLOOR;
      ceilRef.current = DEFAULT_CEIL;
      setLufsFloor(DEFAULT_FLOOR);
      setLufsCeil(DEFAULT_CEIL);
      return;
    }
    // Auto-range from integrated loudness estimate
    const est = data.integrated_loudness_estimate;
    const autoFloor = Math.max(ABS_MIN, Math.floor((est - 12) / 6) * 6);
    const autoCeil = Math.min(ABS_MAX, Math.max(Math.ceil((est + 6) / 3) * 3, autoFloor + 6));

    floorRef.current = autoFloor;
    ceilRef.current = autoCeil;
    setLufsFloor(autoFloor);
    setLufsCeil(autoCeil);
  });

  useAudioData("audio-data", (payload) => {
    dataRef.current = payload.loudness;
  });

  const controlH = 24;
  const canvasHeight = height - controlH;

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasHeight <= 0) return;

    const ctx = getCanvasCtx(canvas, width, canvasHeight, ctxCache.current);
    if (!ctx) return;

    clearCanvas(ctx, width, canvasHeight, colors.bgPanel);

    const floor = floorRef.current;
    const ceil = ceilRef.current;
    if (ceil <= floor) return;

    const padding = { top: 10, right: 10, bottom: 36, left: 36 };
    const plotW = width - padding.left - padding.right;
    const plotH = canvasHeight - padding.top - padding.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    // 5 bars: Total, Mid, Side, L, R
    const barCount = 5;
    const totalGap = Math.max(barCount - 1, 0) * 4;
    const barWidth = Math.max(4, Math.floor((plotW - totalGap) / barCount));
    const barStep = barWidth + 4;

    const segGap = 2;
    const segH = Math.max(1, (plotH - segGap * (SEGMENT_COUNT - 1)) / SEGMENT_COUNT);
    const segRadius = Math.min(1.5, segH * 0.3);

    const loud = dataRef.current;
    const truePeak = Math.max(loud?.true_peak_l ?? -90, loud?.true_peak_r ?? -90);
    const bars: { label: string; lufs: number }[] = [
      { label: "M", lufs: loud?.momentary ?? -90 },
      { label: "S", lufs: loud?.short_term ?? -90 },
      { label: "TP", lufs: truePeak },
      { label: "Mid", lufs: loud?.mid_short ?? -90 },
      { label: "Side", lufs: loud?.side_short ?? -90 },
    ];

    const drawLedBar = (lufs: number, barX: number, bw: number) => {
      const clamped = Math.max(floor, Math.min(ceil, lufs));
      const levelNorm = lufsToNorm(clamped, floor, ceil);
      const activeSegs = Math.floor(levelNorm * SEGMENT_COUNT);

      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const sy = padding.top + plotH - (i + 1) * segH - i * segGap;
        const color = segmentLufsColor(i, floor, ceil);
        const isActive = i < activeSegs;

        ctx.fillStyle = color;
        ctx.globalAlpha = isActive ? 1 : 0.1;
        ctx.beginPath();
        ctx.roundRect(barX, sy, bw, segH, segRadius);
        ctx.fill();

        if (isActive) {
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          ctx.roundRect(barX - 1, sy - 1, bw + 2, segH + 2, segRadius);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Value bubble
      const levelY = padding.top + plotH * (1 - levelNorm);
      const bubbleX = barX + bw / 2;
      const bubbleY = levelY - 2;
      const valText = formatLufs(clamped, floor);
      const valColor = lufsColor(clamped);
      drawBubble(ctx, bubbleX, bubbleY, valText, valColor, valColor);
    };

    // Draw all 5 bars
    for (let b = 0; b < barCount; b++) {
      const barX = padding.left + b * barStep;
      drawLedBar(bars[b].lufs, barX, barWidth);
    }

    // -14 LUFS reference line
    const lastBarRight = padding.left + (barCount - 1) * barStep + barWidth;
    if (REFERENCE_LUFS >= floor && REFERENCE_LUFS <= ceil) {
      const refNorm = lufsToNorm(REFERENCE_LUFS, floor, ceil);
      const refY = padding.top + plotH * (1 - refNorm);
      ctx.strokeStyle = colors.peakHold;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padding.left - 4, refY);
      ctx.lineTo(lastBarRight + 4, refY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "7px monospace";
      ctx.textAlign = "left";
      glowText(ctx, "-14", lastBarRight + 4, refY + 3, colors.peakHold, "rgba(244,114,182,0.4)");
    }

    // Scale markers
    const allMarkers = [-60, -48, -36, -24, -20, -18, -14, -10, -6, -3, 0];
    const visibleMarkers = allMarkers.filter((v) => v >= floor && v <= ceil);
    ctx.font = "7px monospace";
    ctx.textAlign = "right";
    for (const lufs of visibleMarkers) {
      const norm = lufsToNorm(lufs, floor, ceil);
      const y = padding.top + plotH * (1 - norm);
      glowText(ctx, `${lufs}`, padding.left - 5, y + 3);
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(padding.left - 2, y);
      ctx.lineTo(padding.left, y);
      ctx.stroke();
    }

    // Bar labels
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    for (let b = 0; b < barCount; b++) {
      const barX = padding.left + b * barStep;
      glowText(ctx, bars[b].label, barX + barWidth / 2, canvasHeight - padding.bottom + 12, colors.textPrimary, "rgba(237,237,244,0.35)");
    }
    ctx.font = "7px monospace";
    glowText(ctx, "LUFS", width / 2, canvasHeight - 2);
  });

  const handleLow = useCallback((v: number) => {
    const f = sliderToLufs(v);
    floorRef.current = f;
    setLufsFloor(f);
  }, []);
  const handleHigh = useCallback((v: number) => {
    const c = sliderToLufs(v);
    ceilRef.current = c;
    setLufsCeil(c);
  }, []);

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
        <span style={{ fontSize: 9, fontFamily: "monospace", color: colors.textDim, minWidth: 24, textAlign: "right" }}>
          {lufsFloor}
        </span>
        <NeonRangeSlider
          low={lufsToSlider(lufsFloor)}
          high={lufsToSlider(lufsCeil)}
          onChangeLow={handleLow}
          onChangeHigh={handleHigh}
          gradient={`linear-gradient(90deg, ${colors.levelOk}, ${colors.levelWarn}, ${colors.levelOver})`}
        />
        <span style={{ fontSize: 9, fontFamily: "monospace", color: colors.textDim, minWidth: 16 }}>
          {lufsCeil}
        </span>
      </div>
    </div>
  );
}
