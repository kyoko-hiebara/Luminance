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

    // ─── Side L/R level bars (fill the margins on both sides) ─────────
    const levels = levelsRef.current;
    const barMargin = 4;
    const lBarX = barMargin;
    const rBarX = width - barMargin - 5;
    const sideBarW = 5;
    const barTop = 6;
    const barBot = scopeH - 6;
    const barFullH = barBot - barTop;

    // dB to 0..1
    const dbNorm = (db: number) => Math.max(0, Math.min(1, (Math.max(-60, db) + 60) / 60));

    const rmsL = dbNorm(levels?.rms_l ?? -90);
    const rmsR = dbNorm(levels?.rms_r ?? -90);
    const peakL = dbNorm(levels?.peak_l ?? -90);
    const peakR = dbNorm(levels?.peak_r ?? -90);

    // Rainbow gradient for bars: red(bottom) → yellow → green → cyan → blue → purple(top)
    const rainbowGrad = ctx.createLinearGradient(0, barBot, 0, barTop);
    rainbowGrad.addColorStop(0.0, "hsl(0,90%,55%)");     // red
    rainbowGrad.addColorStop(0.2, "hsl(40,90%,55%)");    // orange
    rainbowGrad.addColorStop(0.35, "hsl(60,90%,55%)");   // yellow
    rainbowGrad.addColorStop(0.5, "hsl(120,85%,50%)");   // green
    rainbowGrad.addColorStop(0.65, "hsl(180,85%,50%)");  // cyan
    rainbowGrad.addColorStop(0.8, "hsl(240,80%,60%)");   // blue
    rainbowGrad.addColorStop(1.0, "hsl(280,80%,55%)");   // purple

    const drawSideBar = (x: number, rmsN: number, peakN: number) => {
      // Background track
      ctx.fillStyle = "rgba(40,40,70,0.15)";
      ctx.beginPath();
      ctx.roundRect(x, barTop, sideBarW, barFullH, 2);
      ctx.fill();

      const levelH = rmsN * barFullH;
      const levelY = barBot - levelH;

      // Rainbow glow: horizontal gradient per strip (transparent → color → transparent)
      const glowSteps = 6;
      const stepH = Math.max(1, levelH / glowSteps);
      const spread = 20 + rmsN * 35;
      const cx = x + sideBarW / 2;
      for (let g = 0; g < glowSteps; g++) {
        const t = glowSteps > 1 ? g / (glowSteps - 1) : 0;
        const hue = t * 280;
        const sy = levelY + levelH - (g + 1) * stepH;
        const a = 0.2 + rmsN * 0.3;
        const grad = ctx.createLinearGradient(cx - spread, 0, cx + spread, 0);
        grad.addColorStop(0, `hsla(${hue},90%,55%,0)`);
        grad.addColorStop(0.35, `hsla(${hue},90%,55%,${a})`);
        grad.addColorStop(0.5, `hsla(${hue},90%,60%,${a * 1.2})`);
        grad.addColorStop(0.65, `hsla(${hue},90%,55%,${a})`);
        grad.addColorStop(1, `hsla(${hue},90%,55%,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(cx - spread, sy, spread * 2, stepH + 1);
      }

      // Main bar fill — rainbow gradient (opaque, covers glow center)
      ctx.fillStyle = rainbowGrad;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.roundRect(x, levelY, sideBarW, levelH, 2);
      ctx.fill();

      // Peak marker
      const peakY = barBot - peakN * barFullH;
      ctx.fillStyle = colors.peakHold;
      ctx.fillRect(x, peakY - 1, sideBarW, 2);
    };

    drawSideBar(lBarX, rmsL, peakL);
    drawSideBar(rBarX, rmsR, peakR);

    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    glowText(ctx, "L", lBarX + sideBarW / 2, barBot + 9);
    glowText(ctx, "R", rBarX + sideBarW / 2, barBot + 9);

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
