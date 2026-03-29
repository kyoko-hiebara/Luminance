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

// Absolute bounds the user can choose within
const ABS_MIN = -60;
const ABS_MAX = 6;
const ABS_RANGE = ABS_MAX - ABS_MIN;
const DEFAULT_FLOOR = -24;
const DEFAULT_CEIL = 3;
const SEGMENT_COUNT = 40;

function dbToNorm(db: number, floor: number, ceil: number): number {
  return Math.max(0, Math.min(1, (db - floor) / (ceil - floor)));
}

function zoneColor(db: number): string {
  if (db > -6) return "#ed7953";  // warm orange (hot)
  if (db > -12) return "#edc8b0"; // warm cream (mid)
  return "#cc4778";               // pink (cool)
}

function segmentZoneColor(i: number, floor: number, ceil: number): string {
  const db = floor + (i / SEGMENT_COUNT) * (ceil - floor);
  return zoneColor(db);
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

function dbToSlider(db: number): number {
  return (db - ABS_MIN) / ABS_RANGE;
}
function sliderToDb(v: number): number {
  return Math.round(ABS_MIN + v * ABS_RANGE);
}

export function VUMeter({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxCache = useRef({ w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null });
  const dataRef = useRef<AudioData["levels"] | null>(null);
  const peakHoldRef = useRef({ l: -90, r: -90, lTime: 0, rTime: 0 });

  const [dbFloor, setDbFloor] = useState(DEFAULT_FLOOR);
  const [dbCeil, setDbCeil] = useState(DEFAULT_CEIL);
  const floorRef = useRef(DEFAULT_FLOOR);
  const ceilRef = useRef(DEFAULT_CEIL);

  useFileAnalysis((data) => {
    if (!data) {
      // Reset to defaults for mic mode
      floorRef.current = DEFAULT_FLOOR;
      ceilRef.current = DEFAULT_CEIL;
      setDbFloor(DEFAULT_FLOOR);
      setDbCeil(DEFAULT_CEIL);
      return;
    }
    // Auto-range from file analysis
    const peakDb = Math.max(data.peak_l_db, data.peak_r_db);
    const quietDb = Math.max(data.rms_l_db, data.rms_r_db) - data.dynamic_range_db;

    const autoFloor = Math.max(ABS_MIN, Math.floor((quietDb - 3) / 6) * 6);
    const autoCeil = Math.min(ABS_MAX, Math.ceil((peakDb + 3) / 3) * 3);

    floorRef.current = autoFloor;
    ceilRef.current = Math.max(autoCeil, autoFloor + 6);
    setDbFloor(autoFloor);
    setDbCeil(Math.max(autoCeil, autoFloor + 6));
  });

  useAudioData("audio-data", (payload) => {
    dataRef.current = payload.levels;
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

    const levels = dataRef.current;
    const padding = { top: 22, right: 10, bottom: 20, left: 28 };
    const barHeight = Math.floor((canvasHeight - padding.top - padding.bottom - 12) / 2);
    const barWidth = width - padding.left - padding.right;
    if (barWidth <= 0 || barHeight <= 0) return;

    const segGap = 2;
    const segW = Math.max(1, (barWidth - segGap * (SEGMENT_COUNT - 1)) / SEGMENT_COUNT);
    const segH = barHeight;
    const segRadius = Math.min(1.5, segW * 0.3);

    // Labels
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    glowText(ctx, "L", padding.left - 8, padding.top + barHeight / 2);
    glowText(ctx, "R", padding.left - 8, padding.top + barHeight + 12 + barHeight / 2);
    ctx.textBaseline = "alphabetic";

    // Dynamic scale markers
    const allMarkers = [-60, -48, -36, -24, -18, -12, -6, -3, 0, 3, 6];
    const visibleMarkers = allMarkers.filter((db) => db >= floor && db <= ceil);
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    for (const db of visibleMarkers) {
      const x = padding.left + dbToNorm(db, floor, ceil) * barWidth;
      glowText(ctx, db > 0 ? `+${db}` : `${db}`, x, canvasHeight - 3);
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + barHeight * 2 + 12);
      ctx.stroke();
    }

    // Peak hold
    const now = performance.now();
    const ph = peakHoldRef.current;
    const rmsL = levels?.rms_l ?? -90;
    const rmsR = levels?.rms_r ?? -90;
    const peakL = levels?.peak_l ?? -90;
    const peakR = levels?.peak_r ?? -90;
    const dL = Math.max(floor, Math.min(ceil, rmsL));
    const dR = Math.max(floor, Math.min(ceil, rmsR));
    const dpL = Math.max(floor, Math.min(ceil, peakL));
    const dpR = Math.max(floor, Math.min(ceil, peakR));

    if (dpL >= ph.l) { ph.l = dpL; ph.lTime = now; }
    else if (now - ph.lTime > 1000) { ph.l -= 0.3; }
    if (dpR >= ph.r) { ph.r = dpR; ph.rTime = now; }
    else if (now - ph.rTime > 1000) { ph.r -= 0.3; }

    const drawLedBar = (db: number, peakDb: number, y: number) => {
      const levelNorm = dbToNorm(db, floor, ceil);
      const activeSegs = Math.floor(levelNorm * SEGMENT_COUNT);
      const peakNorm = dbToNorm(peakDb, floor, ceil);
      const peakSeg = Math.min(SEGMENT_COUNT - 1, Math.floor(peakNorm * SEGMENT_COUNT));

      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const sx = padding.left + i * (segW + segGap);
        const color = segmentZoneColor(i, floor, ceil);
        const isActive = i < activeSegs;
        const isPeak = i === peakSeg && peakDb > floor;

        if (isPeak) {
          ctx.fillStyle = colors.peakHold;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.roundRect(sx, y, segW, segH, segRadius);
          ctx.fill();
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.roundRect(sx - 1, y - 1, segW + 2, segH + 2, segRadius);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (isActive) {
          ctx.fillStyle = color;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.roundRect(sx, y, segW, segH, segRadius);
          ctx.fill();
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          ctx.roundRect(sx - 1, y - 1, segW + 2, segH + 2, segRadius);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.1;
          ctx.beginPath();
          ctx.roundRect(sx, y, segW, segH, segRadius);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      const bubbleX = padding.left + levelNorm * barWidth;
      const bubbleY = y - 2;
      const dbVal = db <= floor ? "-inf" : db.toFixed(1);
      const bColor = zoneColor(db);
      drawBubble(ctx, bubbleX, bubbleY, dbVal, bColor, bColor);
    };

    drawLedBar(dL, ph.l, padding.top);
    drawLedBar(dR, ph.r, padding.top + barHeight + 12);
  });

  const handleLow = useCallback((v: number) => {
    const f = sliderToDb(v);
    floorRef.current = f;
    setDbFloor(f);
  }, []);
  const handleHigh = useCallback((v: number) => {
    const c = sliderToDb(v);
    ceilRef.current = c;
    setDbCeil(c);
  }, []);

  return (
    <div className="flex flex-col" style={{ height: "100%" }}>
      <canvas ref={canvasRef} style={{ flex: 1, minHeight: 0 }} />
      <div
        data-control-bar className="flex items-center gap-2 px-2"
        style={{
          height: controlH,
          background: colors.bgPanel,
          borderTop: `1px solid ${colors.borderPanel}`,
        }}
      >
        <span style={{ fontSize: 9, fontFamily: "monospace", color: colors.textDim, minWidth: 28, textAlign: "right" }}>
          {dbFloor}
        </span>
        <NeonRangeSlider
          low={dbToSlider(dbFloor)}
          high={dbToSlider(dbCeil)}
          onChangeLow={handleLow}
          onChangeHigh={handleHigh}
          gradient="linear-gradient(90deg, #cc4778, #edc8b0, #ed7953)"
        />
        <span style={{ fontSize: 9, fontFamily: "monospace", color: colors.textDim, minWidth: 24 }}>
          {dbCeil > 0 ? `+${dbCeil}` : dbCeil}
        </span>
        <span style={{ fontSize: 8, fontFamily: "monospace", color: colors.textDim }}>dB</span>
      </div>
    </div>
  );
}
