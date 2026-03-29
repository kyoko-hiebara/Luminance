import { useRef, useState, useCallback } from "react";
import { useAudioData, type AudioData } from "@/hooks/useAudioData";
import { useAnimationFrame } from "@/hooks/useAnimationFrame";
import { useFileAnalysis } from "@/hooks/useFileAnalysis";
import { useBpm } from "@/hooks/useBpm";
import { getCanvasCtx, clearCanvas, glowText } from "@/lib/canvas";
import { colors } from "@/lib/colors";

interface Props {
  width: number;
  height: number;
}

// Note value options: label, multiplier in beats
const NOTE_VALUES = [
  { label: "1/16", beats: 0.25 },
  { label: "1/8", beats: 0.5 },
  { label: "1/4", beats: 1 },
  { label: "1/2", beats: 2 },
  { label: "1bar", beats: 4 },
] as const;

// Backend: FFT_SIZE=8192, WAVEFORM_DISPLAY_SAMPLES=512 → ratio=16
const DECIMATE_RATIO = 16;
const DEFAULT_SAMPLE_RATE = 44100;

function findTriggerPoint(samples: number[]): number {
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) return i;
  }
  return 0;
}

export function Oscilloscope({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxCache = useRef({ w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null });
  const dataRef = useRef<AudioData["waveform"] | null>(null);
  const prevFrameRef = useRef<Float32Array | null>(null);
  const triggerFlashRef = useRef(0);

  const { bpmRef } = useBpm();
  const [noteIdx, setNoteIdx] = useState(2); // default 1/4
  const noteIdxRef = useRef(2);
  const sampleRateRef = useRef(DEFAULT_SAMPLE_RATE);

  useFileAnalysis((data) => {
    if (data) sampleRateRef.current = data.sample_rate;
  });

  useAudioData("audio-data", (payload) => {
    dataRef.current = payload.waveform;
  });

  const controlH = 26;
  const canvasHeight = height - controlH;

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasHeight <= 0) return;

    const ctx = getCanvasCtx(canvas, width, canvasHeight, ctxCache.current);
    if (!ctx) return;

    clearCanvas(ctx, width, canvasHeight, colors.bgPanel);

    const padding = { top: 18, right: 10, bottom: 18, left: 28 };
    const plotW = width - padding.left - padding.right;
    const plotH = canvasHeight - padding.top - padding.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const centerY = padding.top + plotH / 2;

    // BPM-synced display length
    const currentBpm = bpmRef.current;
    const noteBeats = NOTE_VALUES[noteIdxRef.current].beats;
    const beatSec = 60 / currentBpm;
    const noteSec = beatSec * noteBeats;
    const displaySR = sampleRateRef.current / DECIMATE_RATIO;
    const targetSamples = Math.round(noteSec * displaySR);

    // Beat grid: how many beats fit in the display window
    const beatsInView = noteBeats;
    const subdivisionsPerBeat = 4; // show 16th note grid

    // --- Grid ---
    ctx.strokeStyle = "rgba(40,40,70,0.8)";
    ctx.lineWidth = 0.5;

    // Horizontal lines
    ctx.beginPath();
    ctx.moveTo(padding.left, centerY);
    ctx.lineTo(padding.left + plotW, centerY);
    ctx.stroke();
    for (const frac of [0.25, 0.75]) {
      const y = padding.top + plotH * frac;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotW, y);
      ctx.stroke();
    }

    // Beat division vertical lines
    const totalSubs = Math.round(beatsInView * subdivisionsPerBeat);
    for (let s = 1; s < totalSubs; s++) {
      const x = padding.left + (s / totalSubs) * plotW;
      const isBeatLine = s % subdivisionsPerBeat === 0;
      ctx.strokeStyle = isBeatLine ? "rgba(60,60,100,0.9)" : "rgba(40,40,70,0.35)";
      ctx.lineWidth = isBeatLine ? 0.8 : 0.5;
      if (!isBeatLine) ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotH);
      ctx.stroke();
      if (!isBeatLine) ctx.setLineDash([]);
    }

    // Plot frame
    ctx.strokeStyle = colors.borderPanel;
    ctx.lineWidth = 1;
    ctx.strokeRect(padding.left, padding.top, plotW, plotH);

    // Axis labels
    ctx.font = "8px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    glowText(ctx, "+", padding.left - 4, padding.top + 6);
    glowText(ctx, "0", padding.left - 4, centerY);
    glowText(ctx, "-", padding.left - 4, padding.top + plotH - 6);

    // Beat labels along bottom
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let b = 0; b <= beatsInView; b++) {
      const x = padding.left + (b / beatsInView) * plotW;
      const label = b === 0 ? "0" : noteBeats <= 1 ? `${b}/${Math.round(1 / noteBeats * b)}` : `${b}`;
      glowText(ctx, label, x, padding.top + plotH + 4);
    }

    // --- Previous frame persistence ---
    if (prevFrameRef.current && prevFrameRef.current.length > 0) {
      const prev = prevFrameRef.current;
      const prevStep = plotW / prev.length;
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = "#4b2f6b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < prev.length; i++) {
        const x = padding.left + i * prevStep;
        const y = centerY - prev[i] * (plotH * 0.45);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    const waveform = dataRef.current;
    if (!waveform || waveform.samples_l.length === 0) return;

    const samples = waveform.samples_l;
    const triggerIdx = findTriggerPoint(samples);

    // Display window = BPM-synced length, capped to available data
    const displayLength = Math.min(targetSamples, samples.length - triggerIdx);
    if (displayLength <= 0) return;

    const triggered = samples.slice(triggerIdx, triggerIdx + displayLength);
    prevFrameRef.current = new Float32Array(triggered);

    const step = plotW / triggered.length;

    // Glow layer
    ctx.save();
    ctx.strokeStyle = "rgba(200,160,180,0.15)";
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < triggered.length; i++) {
      const x = padding.left + i * step;
      const y = centerY - triggered[i] * (plotH * 0.45);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Main phosphor line
    const lineGrad = ctx.createLinearGradient(padding.left, 0, padding.left + plotW, 0);
    lineGrad.addColorStop(0, "#c26a6e");
    lineGrad.addColorStop(1, "#e8a77a");

    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "#c26a6e";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < triggered.length; i++) {
      const x = padding.left + i * step;
      const y = centerY - triggered[i] * (plotH * 0.45);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // TRIG indicator
    if (triggerIdx > 0) triggerFlashRef.current = 1.0;
    else triggerFlashRef.current = Math.max(0, triggerFlashRef.current - 0.05);

    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.5 + triggerFlashRef.current * 0.5);
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    if (triggerFlashRef.current > 0.3) {
      glowText(ctx, "TRIG", padding.left + 3, padding.top + 3, "#e8a77a", "rgba(232,167,122,0.5)");
    } else {
      glowText(ctx, "TRIG", padding.left + 3, padding.top + 3);
    }
    ctx.restore();

    // Note value & ms display
    ctx.font = "8px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const msLabel = `${(noteSec * 1000).toFixed(0)}ms`;
    glowText(ctx, msLabel, padding.left + plotW - 3, padding.top + 3);
  });

  const cycleNote = useCallback(() => {
    setNoteIdx((prev) => {
      const next = (prev + 1) % NOTE_VALUES.length;
      noteIdxRef.current = next;
      return next;
    });
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
        <button
          onClick={cycleNote}
          style={{
            fontSize: 10,
            fontFamily: "monospace",
            padding: "1px 8px",
            borderRadius: 3,
            border: `1px solid ${colors.borderPanel}`,
            background: `${colors.accent}22`,
            color: colors.accent,
            cursor: "pointer",
            lineHeight: "14px",
            fontWeight: "bold",
          }}
        >
          {NOTE_VALUES[noteIdx].label}
        </button>
        <span style={{ fontSize: 8, fontFamily: "monospace", color: colors.textDim }}>
          {(60 / bpmRef.current * NOTE_VALUES[noteIdx].beats * 1000).toFixed(0)}ms
        </span>
      </div>
    </div>
  );
}
