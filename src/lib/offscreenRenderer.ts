import { colors } from "@/lib/colors";
import type { AudioData } from "@/hooks/useAudioData";

const GAP = 2;
const MAX_SPECTROGRAM_ROWS = 256;

export class OffscreenRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;

  private spectrogramHistory: number[][] = [];
  private prevWaveformL: number[] = [];
  // prevWaveformR reserved for future R-channel persistence

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
  }

  /**
   * Render a full frame and return base64-encoded JPEG string (no data URL prefix).
   */
  renderFrameAsBase64(data: AudioData): string {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Dark background (acts as gap color)
    ctx.fillStyle = colors.bgPrimary;
    ctx.fillRect(0, 0, w, h);

    // Grid: 3 columns (1fr 1fr 1fr), 3 rows (1fr 1fr 1fr)
    const colW = Math.floor((w - GAP * 2) / 3);
    const rowH = Math.floor((h - GAP * 2) / 3);

    const col0 = 0;
    const col1 = colW + GAP;
    const col2 = colW * 2 + GAP * 2;
    const col2W = w - col2; // last column takes remainder

    const row0 = 0;
    const row1 = rowH + GAP;
    const row2 = rowH * 2 + GAP * 2;
    const row2H = h - row2; // last row takes remainder

    // Spectrum: rows 0-1, column 0 (spans 2 rows)
    const spectrumX = col0;
    const spectrumY = row0;
    const spectrumW = colW;
    const spectrumH = rowH * 2 + GAP;
    this.drawPanelBg(ctx, spectrumX, spectrumY, spectrumW, spectrumH);
    this.drawSpectrum(ctx, data, spectrumX, spectrumY, spectrumW, spectrumH);

    // VU Meter: row 0, column 1
    const vuX = col1;
    const vuY = row0;
    const vuW = colW;
    const vuH = rowH;
    this.drawPanelBg(ctx, vuX, vuY, vuW, vuH);
    this.drawVUMeter(ctx, data, vuX, vuY, vuW, vuH);

    // Loudness: row 0, column 2
    const loudX = col2;
    const loudY = row0;
    const loudW = col2W;
    const loudH = rowH;
    this.drawPanelBg(ctx, loudX, loudY, loudW, loudH);
    this.drawLoudness(ctx, data, loudX, loudY, loudW, loudH);

    // Stereometer: row 1, column 1
    const stereoX = col1;
    const stereoY = row1;
    const stereoW = colW;
    const stereoH = rowH;
    this.drawPanelBg(ctx, stereoX, stereoY, stereoW, stereoH);
    this.drawStereometer(ctx, data, stereoX, stereoY, stereoW, stereoH);

    // Oscilloscope: row 1, column 2
    const oscX = col2;
    const oscY = row1;
    const oscW = col2W;
    const oscH = rowH;
    this.drawPanelBg(ctx, oscX, oscY, oscW, oscH);
    this.drawOscilloscope(ctx, data, oscX, oscY, oscW, oscH);

    // Spectrogram: row 2, column 0
    const spectroX = col0;
    const spectroY = row2;
    const spectroW = colW;
    const spectroH = row2H;
    this.drawPanelBg(ctx, spectroX, spectroY, spectroW, spectroH);
    this.drawSpectrogram(ctx, data, spectroX, spectroY, spectroW, spectroH);

    // Waveform: row 2, columns 1-2
    const waveX = col1;
    const waveY = row2;
    const waveW = w - col1;
    const waveH = row2H;
    this.drawPanelBg(ctx, waveX, waveY, waveW, waveH);
    this.drawWaveform(ctx, data, waveX, waveY, waveW, waveH);

    // Return JPEG as base64 (strip data URL prefix)
    const dataUrl = this.canvas.toDataURL("image/jpeg", 0.92);
    return dataUrl.split(",")[1];
  }

  private drawPanelBg(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    ctx.fillStyle = colors.bgPanel;
    ctx.fillRect(x, y, w, h);
  }

  // --- Spectrum (rainbow fill + curve line) ---
  private drawSpectrum(
    ctx: CanvasRenderingContext2D,
    data: AudioData,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const mags = data.spectrum.magnitudes;
    if (!mags || mags.length === 0) return;

    const numBands = mags.length;
    const padding = { top: 8, right: 8, bottom: 8, left: 8 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const ox = x + padding.left;
    const oy = y + padding.top;

    // Rainbow fill gradient
    const grad = ctx.createLinearGradient(ox, 0, ox + plotW, 0);
    const hues = [0, 30, 60, 120, 180, 220, 270, 300];
    for (let i = 0; i < hues.length; i++) {
      grad.addColorStop(i / (hues.length - 1), `hsla(${hues[i]},90%,55%,0.5)`);
    }

    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);

    // Build curve points
    const points: { px: number; py: number }[] = [];
    for (let i = 0; i < numBands; i++) {
      const t = (i + 0.5) / numBands;
      const freq = 20 * Math.pow(1000, t);
      const px = ox + ((Math.log10(freq) - logMin) / (logMax - logMin)) * plotW;
      const db = mags[i];
      const norm = Math.max(0, Math.min(1, (db + 90) / 90));
      const py = oy + plotH * (1 - norm);
      points.push({ px, py });
    }

    // Filled area
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i].px, points[i].py);
      else ctx.lineTo(points[i].px, points[i].py);
    }
    ctx.lineTo(ox + plotW, oy + plotH);
    ctx.lineTo(ox, oy + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Curve stroke
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i].px, points[i].py);
      else ctx.lineTo(points[i].px, points[i].py);
    }
    ctx.strokeStyle = colors.textPrimary;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // --- VU Meter (two horizontal bars L/R, green/yellow/red) ---
  private drawVUMeter(
    ctx: CanvasRenderingContext2D,
    data: AudioData,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const pad = 8;
    const barH = Math.floor((h - pad * 3) / 2);
    if (barH <= 0) return;

    const barX = x + pad;
    const barW = w - pad * 2;

    const drawBar = (rms: number, peak: number, by: number) => {
      const level = Math.max(0, Math.min(1, (rms + 60) / 60)); // -60dB to 0dB
      const peakLevel = Math.max(0, Math.min(1, (peak + 60) / 60));
      const fillW = level * barW;

      // Green / Yellow / Red segments
      const yellowThresh = 0.7;
      const redThresh = 0.9;

      if (fillW > 0) {
        const greenEnd = Math.min(fillW, yellowThresh * barW);
        if (greenEnd > 0) {
          ctx.fillStyle = colors.levelOk;
          ctx.fillRect(barX, by, greenEnd, barH);
        }
        if (fillW > yellowThresh * barW) {
          const yellowEnd = Math.min(fillW, redThresh * barW);
          ctx.fillStyle = colors.levelWarn;
          ctx.fillRect(barX + yellowThresh * barW, by, yellowEnd - yellowThresh * barW, barH);
        }
        if (fillW > redThresh * barW) {
          ctx.fillStyle = colors.levelOver;
          ctx.fillRect(barX + redThresh * barW, by, fillW - redThresh * barW, barH);
        }
      }

      // Peak marker
      const peakX = barX + peakLevel * barW;
      ctx.fillStyle = colors.peakHold;
      ctx.fillRect(peakX - 1, by, 2, barH);
    };

    drawBar(data.levels.rms_l, data.levels.peak_l, y + pad);
    drawBar(data.levels.rms_r, data.levels.peak_r, y + pad + barH + pad);
  }

  // --- Loudness (two vertical bars M/S with LUFS) ---
  private drawLoudness(
    ctx: CanvasRenderingContext2D,
    data: AudioData,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const pad = 8;
    const barW = Math.floor((w - pad * 3) / 2);
    if (barW <= 0) return;

    const barH = h - pad * 2;
    if (barH <= 0) return;

    const drawVertBar = (lufs: number, bx: number) => {
      // LUFS range: -60 to 0
      const norm = Math.max(0, Math.min(1, (lufs + 60) / 60));
      const fillH = norm * barH;
      const by = y + pad + barH - fillH;

      // Color based on level
      let barColor: string = colors.levelOk;
      if (lufs > -14) barColor = colors.levelWarn;
      if (lufs > -6) barColor = colors.levelOver;

      ctx.fillStyle = barColor;
      ctx.fillRect(bx, by, barW, fillH);
    };

    drawVertBar(data.loudness.momentary, x + pad);
    drawVertBar(data.loudness.short_term, x + pad + barW + pad);
  }

  // --- Stereometer (Lissajous dots + correlation bar) ---
  private drawStereometer(
    ctx: CanvasRenderingContext2D,
    data: AudioData,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const { correlation, lissajous_l, lissajous_r } = data.stereo;
    const pad = 8;
    const plotSize = Math.min(w - pad * 2, h - pad * 2 - 12);
    if (plotSize <= 0) return;

    const cx = x + w / 2;
    const cy = y + pad + plotSize / 2;
    const half = plotSize / 2;

    // Lissajous dots
    if (lissajous_l && lissajous_r && lissajous_l.length > 0) {
      ctx.fillStyle = `${colors.accent}88`;
      const len = Math.min(lissajous_l.length, lissajous_r.length);
      for (let i = 0; i < len; i++) {
        const l = lissajous_l[i];
        const r = lissajous_r[i];
        // M/S encoding for display: x = (R-L), y = (L+R)
        const px = cx + (r - l) * half * 0.7;
        const py = cy - (l + r) * half * 0.35;
        ctx.fillRect(px, py, 1.5, 1.5);
      }
    }

    // Correlation bar at bottom
    const barY = y + h - pad - 6;
    const barW = w - pad * 2;
    const barX = x + pad;

    // Background
    ctx.fillStyle = colors.bgPrimary;
    ctx.fillRect(barX, barY, barW, 6);

    // Correlation indicator: -1 (left) to +1 (right), center = 0
    const corrNorm = (correlation + 1) / 2; // 0..1
    const indicatorX = barX + corrNorm * barW;
    const corrColor = correlation > 0.3 ? colors.levelOk : correlation > -0.3 ? colors.levelWarn : colors.levelOver;
    ctx.fillStyle = corrColor;
    ctx.fillRect(indicatorX - 3, barY, 6, 6);

    // Center line
    ctx.strokeStyle = colors.textDim;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(barX + barW / 2, barY);
    ctx.lineTo(barX + barW / 2, barY + 6);
    ctx.stroke();
  }

  // --- Oscilloscope (waveform.samples_l as a line) ---
  private drawOscilloscope(
    ctx: CanvasRenderingContext2D,
    data: AudioData,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const samples = data.waveform.samples_l;
    if (!samples || samples.length === 0) return;

    const pad = 4;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;
    if (plotW <= 0 || plotH <= 0) return;

    const cx = x + pad;
    const cy = y + pad + plotH / 2;
    const amp = plotH / 2;

    // Draw previous frame faded (persistence effect)
    if (this.prevWaveformL.length > 0) {
      ctx.strokeStyle = `${colors.accent}33`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const prevStep = plotW / this.prevWaveformL.length;
      for (let i = 0; i < this.prevWaveformL.length; i++) {
        const px = cx + i * prevStep;
        const py = cy - this.prevWaveformL[i] * amp * 0.9;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Draw current frame
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = plotW / samples.length;
    for (let i = 0; i < samples.length; i++) {
      const px = cx + i * step;
      const py = cy - samples[i] * amp * 0.9;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Center line
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + plotW, cy);
    ctx.stroke();

    // Store for persistence
    this.prevWaveformL = [...samples];
  }

  // --- Spectrogram (rolling history of spectrogram_frame) ---
  private drawSpectrogram(
    ctx: CanvasRenderingContext2D,
    data: AudioData,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const frame = data.spectrogram_frame;
    if (frame && frame.length > 0) {
      this.spectrogramHistory.push(frame);
      if (this.spectrogramHistory.length > MAX_SPECTROGRAM_ROWS) {
        this.spectrogramHistory.shift();
      }
    }

    const history = this.spectrogramHistory;
    if (history.length === 0) return;

    const numRows = history.length;
    const rowH = h / numRows;
    const numBins = history[0].length;
    const binW = numBins > 0 ? w / numBins : 1;

    for (let r = 0; r < numRows; r++) {
      const row = history[r];
      const ry = y + h - (r + 1) * rowH; // newest at bottom

      for (let b = 0; b < row.length; b++) {
        const db = row[b];
        const norm = Math.max(0, Math.min(1, (db + 90) / 90));
        if (norm < 0.01) continue; // skip near-silent bins

        // Map norm to color: blue -> cyan -> green -> yellow -> red
        const hue = (1 - norm) * 240; // 240 (blue) -> 0 (red)
        const lightness = 20 + norm * 40;
        ctx.fillStyle = `hsl(${hue},90%,${lightness}%)`;
        ctx.fillRect(x + b * binW, ry, Math.ceil(binW), Math.ceil(rowH));
      }
    }
  }

  // --- Waveform (L/R with band-energy-based coloring) ---
  private drawWaveform(
    ctx: CanvasRenderingContext2D,
    data: AudioData,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const { samples_l, samples_r, band_l, band_r } = data.waveform;
    if (!samples_l || samples_l.length === 0) return;

    const halfH = h / 2;
    const cy1 = y + halfH * 0.5;
    const cy2 = y + halfH + halfH * 0.5;
    const amp = halfH * 0.4;

    // Band color
    const bandToHue = (lo: number, mi: number, hi: number) => {
      const tot = lo + mi + hi;
      if (tot < 0.001) return 0;
      const bal = (mi * 0.5 + hi) / tot;
      return Math.pow(Math.max(0.001, bal), 0.35) * 300;
    };
    const hueL = bandToHue(band_l[0], band_l[1], band_l[2]);
    const hueR = bandToHue(band_r[0], band_r[1], band_r[2]);

    const step = w / samples_l.length;

    // Draw L channel
    ctx.strokeStyle = `hsl(${hueL},92%,58%)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < samples_l.length; i++) {
      const px = x + i * step;
      const py = cy1 - samples_l[i] * amp;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Draw R channel
    if (samples_r && samples_r.length > 0) {
      ctx.strokeStyle = `hsl(${hueR},92%,58%)`;
      ctx.beginPath();
      for (let i = 0; i < samples_r.length; i++) {
        const px = x + i * step;
        const py = cy2 - samples_r[i] * amp;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Center divider
    ctx.strokeStyle = colors.borderPanel;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + halfH);
    ctx.lineTo(x + w, y + halfH);
    ctx.stroke();
  }

  destroy() {
    this.spectrogramHistory = [];
    this.prevWaveformL = [];
    // cleanup complete
  }
}
