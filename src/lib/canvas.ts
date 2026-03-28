/** Set up a canvas for HiDPI rendering (re-creates buffer every call — use sparingly) */
export function setupCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.maxWidth = "100%";
  canvas.style.maxHeight = "100%";

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(dpr, dpr);
  }
  return ctx;
}

/**
 * Get or create a cached canvas context. Only re-initializes when dimensions change.
 * Much faster than setupCanvas() for per-frame rendering (avoids GPU buffer reallocation).
 */
export function getCanvasCtx(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  cache: { w: number; h: number; ctx: CanvasRenderingContext2D | null }
): CanvasRenderingContext2D | null {
  if (cache.w !== width || cache.h !== height || !cache.ctx) {
    cache.ctx = setupCanvas(canvas, width, height);
    cache.w = width;
    cache.h = height;
  }
  return cache.ctx;
}

/** Clear the canvas with the given color */
export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string
) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

/** Draw text with a soft glow (emissive label look). Call this instead of fillText for labels. */
export function glowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = "#9a9ab4",
  glowColor = "rgba(170,170,230,0.6)"
) {
  ctx.save();
  // Double-draw for stronger glow: wide soft + tight bright
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 3;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Draw a rounded rectangle */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
