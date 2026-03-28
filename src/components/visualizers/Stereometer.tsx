import { useRef } from "react";
import { useAudioData, type AudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { getCanvasCtx, clearCanvas, glowText } from "@/lib/canvas";
import { colors } from "@/lib/colors";

interface Props {
  width: number;
  height: number;
}

const CORR_SEGMENTS = 30;

/** Interpolate between two hex colors */
function lerpColor(a: string, b: string, t: number): string {
  const parseHex = (hex: string) => {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  };
  const ca = parseHex(a);
  const cb = parseHex(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Get color for a segment index in the correlation bar (0 = -1, CORR_SEGMENTS-1 = +1) */
function corrSegmentColor(i: number): string {
  const t = i / (CORR_SEGMENTS - 1); // 0..1 maps to -1..+1
  if (t < 0.3) {
    return lerpColor(colors.levelOver, colors.levelWarn, t / 0.3);
  } else if (t < 0.6) {
    return colors.levelWarn;
  } else {
    return lerpColor(colors.levelWarn, colors.levelOk, (t - 0.6) / 0.4);
  }
}

/** Get color for a correlation value */
function corrValueColor(corr: number): string {
  if (corr < -0.5) return colors.levelOver;
  if (corr < 0) return lerpColor(colors.levelOver, colors.levelWarn, (corr + 0.5) * 2);
  if (corr < 0.5) return lerpColor(colors.levelWarn, colors.levelOk, corr * 2);
  return colors.levelOk;
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
  const px = Math.max(
    pw / 2,
    Math.min(
      x,
      ctx.canvas.width / (window.devicePixelRatio || 1) - pw / 2
    )
  );
  const py = Math.max(ph, y);

  // Background
  ctx.fillStyle = "rgba(12,12,26,0.92)";
  ctx.beginPath();
  ctx.roundRect(px - pw / 2, py - ph, pw, ph, 3);
  ctx.fill();

  // Border
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px - pw / 2, py - ph, pw, ph, 3);
  ctx.stroke();

  // Text
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowBlur = 4;
  ctx.shadowColor = textColor;
  ctx.fillStyle = textColor;
  ctx.fillText(text, px, py - ph / 2);
  ctx.shadowBlur = 0;
  ctx.textBaseline = "alphabetic"; // reset
}

export function Stereometer({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxCache = useRef({
    w: 0,
    h: 0,
    ctx: null as CanvasRenderingContext2D | null,
  });
  const dataRef = useRef<AudioData["stereo"] | null>(null);

  useAudioData("audio-data", (payload) => {
    dataRef.current = payload.stereo;
  });

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = getCanvasCtx(canvas, width, height, ctxCache.current);
    if (!ctx) return;

    clearCanvas(ctx, width, height, colors.bgPanel);

    // Split layout: top 70% = Lissajous, bottom 30% = Correlation bar
    const lissajousH = Math.floor(height * 0.7);
    const corrY = lissajousH;
    const corrH = height - lissajousH;

    // --- Lissajous section ---
    const scopeSize = Math.min(width, lissajousH) - 16;
    const scopeCX = width / 2;
    const scopeCY = lissajousH / 2;
    const scopeR = scopeSize / 2;

    if (scopeR > 0) {
      // Draw scope boundary
      ctx.strokeStyle = colors.borderPanel;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(scopeCX, scopeCY, scopeR, 0, Math.PI * 2);
      ctx.stroke();

      // Draw crosshairs
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 0.5;

      // Horizontal axis (Side = L-R)
      ctx.beginPath();
      ctx.moveTo(scopeCX - scopeR, scopeCY);
      ctx.lineTo(scopeCX + scopeR, scopeCY);
      ctx.stroke();

      // Vertical axis (Mid = L+R)
      ctx.beginPath();
      ctx.moveTo(scopeCX, scopeCY - scopeR);
      ctx.lineTo(scopeCX, scopeCY + scopeR);
      ctx.stroke();

      // Diagonal guides (L and R axes, 45 degrees)
      ctx.setLineDash([2, 3]);
      // L axis: top-left to bottom-right
      ctx.beginPath();
      ctx.moveTo(
        scopeCX - scopeR * 0.707,
        scopeCY - scopeR * 0.707
      );
      ctx.lineTo(
        scopeCX + scopeR * 0.707,
        scopeCY + scopeR * 0.707
      );
      ctx.stroke();
      // R axis: top-right to bottom-left
      ctx.beginPath();
      ctx.moveTo(
        scopeCX + scopeR * 0.707,
        scopeCY - scopeR * 0.707
      );
      ctx.lineTo(
        scopeCX - scopeR * 0.707,
        scopeCY + scopeR * 0.707
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // Axis labels: L and R
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      glowText(
        ctx,
        "L",
        scopeCX - scopeR * 0.707 - 8,
        scopeCY - scopeR * 0.707 - 4
      );
      glowText(
        ctx,
        "R",
        scopeCX + scopeR * 0.707 + 8,
        scopeCY - scopeR * 0.707 - 4
      );

      // Draw Lissajous dots with enhanced glow
      const stereo = dataRef.current;
      if (stereo && stereo.lissajous_l.length > 0) {
        const len = Math.min(
          stereo.lissajous_l.length,
          stereo.lissajous_r.length
        );

        // Subtle radial gradient glow behind the dot cluster
        const glowGrad = ctx.createRadialGradient(
          scopeCX,
          scopeCY,
          0,
          scopeCX,
          scopeCY,
          scopeR * 0.6
        );
        glowGrad.addColorStop(0, "rgba(34,197,94,0.08)");
        glowGrad.addColorStop(1, "rgba(34,197,94,0)");
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(scopeCX, scopeCY, scopeR * 0.6, 0, Math.PI * 2);
        ctx.fill();

        // Draw dots: brighter green, larger, more opacity
        ctx.fillStyle = colors.levelOk;
        ctx.globalAlpha = 0.55;

        for (let i = 0; i < len; i++) {
          const l = stereo.lissajous_l[i];
          const r = stereo.lissajous_r[i];

          // M/S transform: Mid (L+R) vertical, Side (R-L) horizontal
          const side = (r - l) * 0.707;
          const mid = (l + r) * 0.707;
          const x = scopeCX + side * scopeR * 0.9;
          const y = scopeCY - mid * scopeR * 0.9;

          ctx.fillRect(x - 1, y - 1, 2, 2);
        }

        ctx.globalAlpha = 1;
      }
    }

    // --- Correlation bar section (LED segment style) ---
    const corrPadding = { left: 24, right: 24, top: 10, bottom: 16 };
    const barX = corrPadding.left;
    const barW = width - corrPadding.left - corrPadding.right;
    const barH = Math.max(8, corrH - corrPadding.top - corrPadding.bottom);
    const barYPos = corrY + corrPadding.top;

    if (barW <= 0) return;

    // Separator line
    ctx.strokeStyle = colors.borderPanel;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, corrY);
    ctx.lineTo(width, corrY);
    ctx.stroke();

    // Segment geometry
    const segGap = 2;
    const segW = Math.max(
      1,
      (barW - segGap * (CORR_SEGMENTS - 1)) / CORR_SEGMENTS
    );
    const segRadius = Math.min(1.5, segW * 0.3);

    const stereo = dataRef.current;
    const correlation = stereo?.correlation ?? 0;
    const corrNorm = Math.max(-1, Math.min(1, correlation));

    // Center index = segment representing 0 correlation
    const centerIndex = Math.floor(CORR_SEGMENTS / 2);
    // Target index based on correlation value: -1 -> 0, 0 -> center, +1 -> CORR_SEGMENTS-1
    const targetIndex = Math.floor(((corrNorm + 1) / 2) * CORR_SEGMENTS);

    for (let i = 0; i < CORR_SEGMENTS; i++) {
      const sx = barX + i * (segW + segGap);
      const color = corrSegmentColor(i);

      // Light up segments from center to current correlation value
      let isActive: boolean;
      if (targetIndex >= centerIndex) {
        isActive = i >= centerIndex && i <= targetIndex;
      } else {
        isActive = i >= targetIndex && i <= centerIndex;
      }

      if (isActive) {
        // Active segment: solid color
        ctx.fillStyle = color;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.roundRect(sx, barYPos, segW, barH, segRadius);
        ctx.fill();

        // Glow effect
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.roundRect(
          sx - 1,
          barYPos - 1,
          segW + 2,
          barH + 2,
          segRadius
        );
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // Inactive segment: very dim
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.1;
        ctx.beginPath();
        ctx.roundRect(sx, barYPos, segW, barH, segRadius);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Center line marker
    const centerX = barX + centerIndex * (segW + segGap) + segW / 2;
    ctx.strokeStyle = colors.textDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, barYPos - 3);
    ctx.lineTo(centerX, barYPos + barH + 3);
    ctx.stroke();

    // Labels below bar
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    glowText(ctx, "-1", barX, barYPos + barH + 11);
    glowText(ctx, "0", centerX, barYPos + barH + 11);
    glowText(ctx, "+1", barX + barW, barYPos + barH + 11);

    // Value bubble at the correlation indicator position
    const corrPixelX =
      barX + ((corrNorm + 1) / 2) * barW;
    const bubbleY = barYPos - 2;
    const corrText = `r: ${corrNorm >= 0 ? "+" : ""}${corrNorm.toFixed(2)}`;
    const corrColor = corrValueColor(corrNorm);
    drawBubble(ctx, corrPixelX, bubbleY, corrText, corrColor, corrColor);
  });

  return <canvas ref={canvasRef} />;
}
