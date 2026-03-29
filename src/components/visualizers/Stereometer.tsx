import { useRef } from "react";
import { useAudioData, type AudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { getCanvasCtx, glowText } from "@/lib/canvas";
import { colors } from "@/lib/colors";

interface Props {
  width: number;
  height: number;
}

const CORR_SEGMENTS = 24;

function corrSegmentColor(i: number): string {
  const t = i / (CORR_SEGMENTS - 1);
  if (t < 0.35) return colors.levelOver;
  if (t < 0.65) return colors.levelWarn;
  return colors.levelOk;
}

function corrValueColor(corr: number): string {
  if (corr < -0.3) return colors.levelOver;
  if (corr < 0.3) return colors.levelWarn;
  return colors.levelOk;
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  text: string, textColor: string, borderColor: string
) {
  ctx.font = "bold 9px monospace";
  const m = ctx.measureText(text);
  const pw = m.width + 8, ph = 14;
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

export function Stereometer({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxCache = useRef({ w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null });
  const dataRef = useRef<AudioData["stereo"] | null>(null);
  const levelsRef = useRef<AudioData["levels"] | null>(null);
  const smoothCorrRef = useRef(0);
  // Waterfall history for L/R levels (each row = one frame's dB value)
  const waterfallW = 12; // width of each side strip in pixels
  const waterfallLRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallRRef = useRef<HTMLCanvasElement | null>(null);

  useAudioData("audio-data", (payload) => {
    dataRef.current = payload.stereo;
    levelsRef.current = payload.levels;
  });

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = getCanvasCtx(canvas, width, height, ctxCache.current);
    if (!ctx) return;

    // Correlation bar at the bottom
    const corrBarH = 28;
    const scopeH = height - corrBarH;
    const scopeCX = width / 2;
    const scopeCY = scopeH / 2;
    const scopeR = Math.min(width, scopeH) * 0.45;

    // ─── Persistence: fade previous frame instead of clearing ─────────
    // Darken previous frame for trail effect
    ctx.fillStyle = "rgba(28,28,46,0.18)";
    ctx.fillRect(0, 0, width, height);

    // ─── Background gradient (subtle radial from center) ──────────────
    const bgGrad = ctx.createRadialGradient(scopeCX, scopeCY, 0, scopeCX, scopeCY, scopeR * 1.3);
    bgGrad.addColorStop(0, "rgba(30,20,50,0.06)");
    bgGrad.addColorStop(1, "rgba(14,14,24,0.04)");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, scopeH);

    // ─── Grid lines (full panel, not just a circle) ───────────────────
    ctx.strokeStyle = "rgba(50,50,90,0.3)";
    ctx.lineWidth = 0.5;

    // Horizontal center
    ctx.beginPath();
    ctx.moveTo(0, scopeCY);
    ctx.lineTo(width, scopeCY);
    ctx.stroke();

    // Vertical center
    ctx.beginPath();
    ctx.moveTo(scopeCX, 0);
    ctx.lineTo(scopeCX, scopeH);
    ctx.stroke();

    // Diagonal guides (L and R axes)
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(50,50,90,0.25)";
    ctx.beginPath();
    ctx.moveTo(scopeCX - scopeR, scopeCY - scopeR);
    ctx.lineTo(scopeCX + scopeR, scopeCY + scopeR);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(scopeCX + scopeR, scopeCY - scopeR);
    ctx.lineTo(scopeCX - scopeR, scopeCY + scopeR);
    ctx.stroke();
    ctx.setLineDash([]);

    // Concentric reference circles
    ctx.strokeStyle = "rgba(50,50,90,0.15)";
    for (const r of [0.33, 0.66, 1.0]) {
      ctx.beginPath();
      ctx.arc(scopeCX, scopeCY, scopeR * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Axis labels — all on their respective axes, symmetrically placed
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // M = top of vertical axis (inside the scope area)
    glowText(ctx, "M", scopeCX + 10, scopeCY - scopeR + 10);
    // S = right of horizontal axis (inside)
    glowText(ctx, "S", scopeCX + scopeR - 10, scopeCY - 8);
    // L = top-left diagonal
    glowText(ctx, "L", scopeCX - scopeR * 0.72 - 10, scopeCY - scopeR * 0.72 - 6);
    // R = top-right diagonal
    glowText(ctx, "R", scopeCX + scopeR * 0.72 + 10, scopeCY - scopeR * 0.72 - 6);
    ctx.textBaseline = "alphabetic";

    // ─── Side L/R waterfall strips ──────────────────────────────────────
    const levels = levelsRef.current;
    const dbNorm = (db: number) => Math.max(0, Math.min(1, (Math.max(-60, db) + 60) / 60));
    const rmsL = dbNorm(levels?.rms_l ?? -90);
    const rmsR = dbNorm(levels?.rms_r ?? -90);

    // dB → color (spectrogram style)
    const dbToRgb = (norm: number): [number, number, number] => {
      // black → purple → blue → cyan → green → yellow → red → white
      const t = norm;
      if (t < 0.15) return [Math.round(t/0.15*40), 0, Math.round(t/0.15*60)];
      if (t < 0.3) { const s=(t-0.15)/0.15; return [40-Math.round(s*40), 0, 60+Math.round(s*195)]; }
      if (t < 0.45) { const s=(t-0.3)/0.15; return [0, Math.round(s*200), 255-Math.round(s*55)]; }
      if (t < 0.6) { const s=(t-0.45)/0.15; return [0, 200+Math.round(s*55), 200-Math.round(s*200)]; }
      if (t < 0.75) { const s=(t-0.6)/0.15; return [Math.round(s*255), 255, 0]; }
      if (t < 0.9) { const s=(t-0.75)/0.15; return [255, 255-Math.round(s*155), 0]; }
      { const s=(t-0.9)/0.1; return [255, 100+Math.round(s*155), Math.round(s*255)]; }
    };

    const drawWaterfall = (wfRef: React.MutableRefObject<HTMLCanvasElement | null>, x: number, norm: number) => {
      const wfH = scopeH;
      // Lazy init offscreen canvas for waterfall history
      let wf = wfRef.current;
      if (!wf || wf.width !== waterfallW || wf.height !== wfH) {
        wf = document.createElement("canvas");
        wf.width = waterfallW;
        wf.height = Math.max(1, wfH);
        wfRef.current = wf;
      }
      const wfCtx = wf.getContext("2d");
      if (!wfCtx) return;

      // Scroll down: copy existing image 1px down
      wfCtx.drawImage(wf, 0, 0, waterfallW, wfH, 0, 1, waterfallW, wfH);

      // Draw new row at top
      const [r, g, b] = dbToRgb(norm);
      wfCtx.fillStyle = `rgb(${r},${g},${b})`;
      wfCtx.fillRect(0, 0, waterfallW, 1);

      // Draw waterfall onto main canvas
      ctx.drawImage(wf, x, 0, waterfallW, wfH);
    };

    drawWaterfall(waterfallLRef, 0, rmsL);
    drawWaterfall(waterfallRRef, width - waterfallW, rmsR);

    // Labels
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    glowText(ctx, "L", waterfallW / 2, scopeH - 3);
    glowText(ctx, "R", width - waterfallW / 2, scopeH - 3);

    // ─── Lissajous dots (fill the whole scope area) ───────────────────
    const stereo = dataRef.current;
    if (stereo && stereo.lissajous_l.length > 0) {
      const len = Math.min(stereo.lissajous_l.length, stereo.lissajous_r.length);

      // Draw dots with varying size and color based on amplitude
      for (let i = 0; i < len; i++) {
        const l = stereo.lissajous_l[i];
        const r = stereo.lissajous_r[i];

        // M/S transform
        const side = (r - l) * 0.707;
        const mid = (l + r) * 0.707;
        const x = scopeCX + side * scopeR * 0.95;
        const y = scopeCY - mid * scopeR * 0.95;

        const amp = Math.sqrt(l * l + r * r);
        const dotSize = 1.5 + amp * 3.0;

        // Color: green center, cyan at edges
        const edgeness = Math.min(1, amp * 2);
        const cr = Math.round(20 + edgeness * 30);
        const cg = Math.round(180 + edgeness * 40);
        const cb = Math.round(140 + edgeness * 80);
        const ca = 0.5 + edgeness * 0.4;

        ctx.fillStyle = `rgba(${cr},${cg},${cb},${ca})`;
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // Bright center glow
      const glowGrad = ctx.createRadialGradient(scopeCX, scopeCY, 0, scopeCX, scopeCY, scopeR * 0.5);
      glowGrad.addColorStop(0, "rgba(34,197,94,0.06)");
      glowGrad.addColorStop(1, "rgba(34,197,94,0)");
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, width, scopeH);
    }

    // ─── Correlation bar (LED segments, bottom strip) ─────────────────
    const corrY = scopeH;
    ctx.fillStyle = colors.bgPanel;
    ctx.fillRect(0, corrY, width, corrBarH);
    ctx.strokeStyle = colors.borderPanel;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, corrY);
    ctx.lineTo(width, corrY);
    ctx.stroke();

    const barPad = { left: 16, right: 16, top: 5, bottom: 12 };
    const barX = barPad.left;
    const barW = width - barPad.left - barPad.right;
    const barH = Math.max(4, corrBarH - barPad.top - barPad.bottom);
    const barYPos = corrY + barPad.top;

    if (barW <= 0) return;

    const segGap = 2;
    const segW = Math.max(1, (barW - segGap * (CORR_SEGMENTS - 1)) / CORR_SEGMENTS);
    const segRadius = Math.min(1.5, segW * 0.3);

    const correlation = stereo?.correlation ?? 0;
    // EMA smoothing on correlation for stable bubble position
    smoothCorrRef.current += (correlation - smoothCorrRef.current) * 0.06;
    const corrNorm = Math.max(-1, Math.min(1, smoothCorrRef.current));
    const centerIdx = Math.floor(CORR_SEGMENTS / 2);
    const targetIdx = Math.floor(((corrNorm + 1) / 2) * CORR_SEGMENTS);

    for (let i = 0; i < CORR_SEGMENTS; i++) {
      const sx = barX + i * (segW + segGap);
      const segColor = corrSegmentColor(i);
      const isActive = targetIdx >= centerIdx
        ? (i >= centerIdx && i <= targetIdx)
        : (i >= targetIdx && i <= centerIdx);

      ctx.fillStyle = segColor;
      ctx.globalAlpha = isActive ? 1 : 0.1;
      ctx.beginPath();
      ctx.roundRect(sx, barYPos, segW, barH, segRadius);
      ctx.fill();
      if (isActive) {
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.roundRect(sx - 1, barYPos - 1, segW + 2, barH + 2, segRadius);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Value bubble
    const bubbleX = barX + ((corrNorm + 1) / 2) * barW;
    const bubbleColor = corrValueColor(corrNorm);
    drawBubble(ctx, bubbleX, barYPos - 1, `r:${corrNorm >= 0 ? "+" : ""}${corrNorm.toFixed(2)}`, bubbleColor, bubbleColor);

    // Labels
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    glowText(ctx, "-1", barX, corrY + corrBarH - 2);
    glowText(ctx, "0", barX + barW / 2, corrY + corrBarH - 2);
    glowText(ctx, "+1", barX + barW, corrY + corrBarH - 2);
  });

  return <canvas ref={canvasRef} />;
}
