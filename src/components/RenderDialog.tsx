import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { colors } from "@/lib/colors";
import type { AudioData } from "@/hooks/useAudioData";

interface Props {
  audioPath: string;
  onClose: () => void;
}

type Phase = "idle" | "rendering" | "encoding" | "complete" | "error" | "cancelled";

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "6px 16px",
    fontSize: 12,
    fontFamily: "monospace",
    fontWeight: "bold",
    borderRadius: 6,
    border: primary ? "none" : `1px solid ${colors.borderPanel}`,
    background: primary ? colors.accent : "transparent",
    color: primary ? "#fff" : colors.textDim,
    cursor: "pointer",
  };
}

/** Composite all canvases + panel titles from the layout area */
function captureLayout(compositeCanvas: HTMLCanvasElement): string | null {
  const layout = document.querySelector("[data-render-target]") as HTMLElement | null;
  if (!layout) return null;

  const rect = layout.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);

  if (compositeCanvas.width !== w * dpr || compositeCanvas.height !== h * dpr) {
    compositeCanvas.width = w * dpr;
    compositeCanvas.height = h * dpr;
  }
  const ctx = compositeCanvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = colors.bgPrimary;
  ctx.fillRect(0, 0, w, h);

  // Draw all panel backgrounds + canvases + titles
  const panels = layout.querySelectorAll("[data-panel]");
  for (const panel of panels) {
    const panelRect = (panel as HTMLElement).getBoundingClientRect();
    const px = panelRect.left - rect.left;
    const py = panelRect.top - rect.top;
    const pw = panelRect.width;
    const ph = panelRect.height;

    // Panel background (no rounded corners for clean video output)
    ctx.fillStyle = colors.bgPanel;
    ctx.fillRect(px, py, pw, ph);
  }

  // Draw all canvases
  const canvases = layout.querySelectorAll("canvas");
  for (const canvas of canvases) {
    const cr = canvas.getBoundingClientRect();
    const cx = cr.left - rect.left;
    const cy = cr.top - rect.top;
    try {
      ctx.drawImage(canvas, cx, cy, cr.width, cr.height);
    } catch {
      // skip tainted canvases
    }
  }

  // Draw panel title bars
  const titleBars = layout.querySelectorAll("[data-panel-title]");
  for (const tb of titleBars) {
    const tbEl = tb as HTMLElement;
    const tbRect = tbEl.getBoundingClientRect();
    const tx = tbRect.left - rect.left;
    const ty = tbRect.top - rect.top;
    const title = tbEl.getAttribute("data-panel-title") || "";

    // Title bar background
    ctx.fillStyle = "#1e1e34";
    ctx.fillRect(tx, ty, tbRect.width, tbRect.height);

    // Accent dot
    ctx.fillStyle = "rgba(139,92,246,0.6)";
    ctx.beginPath();
    ctx.arc(tx + 14, ty + tbRect.height / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Title text
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#c0c0d8";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(title.toUpperCase(), tx + 24, ty + tbRect.height / 2);
  }

  const dataUrl = compositeCanvas.toDataURL("image/jpeg", 0.92);
  return dataUrl.split(",")[1];
}

export function RenderDialog({ audioPath, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [frameCount, setFrameCount] = useState(0);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);

  const compositeRef = useRef<HTMLCanvasElement | null>(null);
  const renderingRef = useRef(false);

  useEffect(() => {
    invoke<string | null>("check_ffmpeg").then((path) => {
      setFfmpegAvailable(path !== null);
    });
    compositeRef.current = document.createElement("canvas");
    return () => { compositeRef.current = null; };
  }, []);

  const startRender = useCallback(async () => {
    const outputPath = await save({
      defaultPath: "output.mp4",
      filters: [{ name: "Video", extensions: ["mp4"] }],
    });
    if (!outputPath) return;

    const layout = document.querySelector("[data-render-target]") as HTMLElement | null;
    if (!layout) { setError("Layout not found"); setPhase("error"); return; }

    const rect = layout.getBoundingClientRect();
    const width = Math.round(rect.width / 2) * 2;
    const height = Math.round(rect.height / 2) * 2;
    const fps = 30;

    setPhase("rendering");
    setError(null);
    setFrameCount(0);

    // Seek to beginning and ensure playing
    try {
      await invoke("seek", { positionSecs: 0.0 });
      // play_pause returns the NEW paused state (true = now paused)
      // Keep toggling until we're playing (not paused)
      let nowPaused = await invoke<boolean>("play_pause");
      if (nowPaused) {
        // Still paused, toggle again
        await invoke("play_pause");
      }
    } catch {
      // transport might not be available
    }

    // Start FFmpeg
    try {
      await invoke("start_render", { audioPath, outputPath, width, height, fps });
    } catch (e) {
      setPhase("error");
      setError(String(e));
      return;
    }

    renderingRef.current = true;
    let frames = 0;
    let knownDuration = 0;
    let lastPosition = 0;
    let staleCount = 0;
    let lastCheckPos = 0;

    // Listen for transport position
    let unlistenAudio: UnlistenFn | null = null;
    unlistenAudio = await listen<AudioData>("audio-data", (event) => {
      const t = event.payload.transport;
      if (t) {
        knownDuration = t.duration_secs;
        lastPosition = t.position_secs;
        setDuration(t.duration_secs);
        setPosition(t.position_secs);
      }
    });

    const finishRecording = async () => {
      if (!renderingRef.current) return;
      renderingRef.current = false;
      unlistenAudio?.();
      setPhase("encoding");
      await new Promise((r) => setTimeout(r, 200));
      try {
        await invoke("finish_render");
        setPhase("complete");
      } catch (e) {
        setPhase("error");
        setError(String(e));
      }
    };

    // Fixed-rate capture loop: exactly 30fps, one frame at a time, await each submit.
    // This guarantees 1:1 frame mapping with FFmpeg's -framerate 30.
    const frameMs = 1000 / fps; // 33.3ms

    const run = async () => {
      while (renderingRef.current) {
        const t0 = performance.now();

        // End check
        if (knownDuration > 0 && lastPosition >= knownDuration - 0.15) {
          await finishRecording(); return;
        }
        if (lastPosition > 0 && Math.abs(lastPosition - lastCheckPos) < 0.01) {
          staleCount++;
          if (staleCount >= 90) { await finishRecording(); return; } // 3s at 30fps
        } else { staleCount = 0; }
        lastCheckPos = lastPosition;

        // Capture one frame
        const composite = compositeRef.current;
        if (composite) {
          const base64 = captureLayout(composite);
          if (base64) {
            frames++;
            if (frames % 10 === 0) setFrameCount(frames);
            try {
              await invoke("submit_frame", { frameData: base64 });
            } catch { break; }
          }
        }

        // Sleep to maintain 30fps cadence
        const elapsed = performance.now() - t0;
        if (elapsed < frameMs) {
          await new Promise((r) => setTimeout(r, frameMs - elapsed));
        }
      }
    };

    run();
  }, [audioPath]);

  const handleCancel = useCallback(async () => {
    renderingRef.current = false;
    try { await invoke("cancel_render"); } catch { /* ignore */ }
    setPhase("cancelled");
  }, []);

  const pct = duration > 0 ? Math.round((position / duration) * 100) : 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: colors.bgPanel,
          border: `1px solid ${colors.borderPanel}`,
          borderRadius: 12,
          padding: 24,
          minWidth: 420,
          maxWidth: 500,
          boxShadow: "0 4px 30px rgba(0,0,0,0.6)",
        }}
      >
        <h2 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: "bold", color: colors.textPrimary, fontFamily: "monospace" }}>
          Video Render
        </h2>

        {ffmpegAvailable === false && (
          <p style={{ color: colors.levelOver, fontSize: 12, marginBottom: 12 }}>
            FFmpeg not found. Please install FFmpeg and add it to your PATH.
          </p>
        )}

        {phase === "idle" && (
          <>
            <div style={{ fontSize: 12, color: colors.textDim, marginBottom: 16, fontFamily: "monospace" }}>
              <div>Captures exactly what you see on screen.</div>
              <div>Automatically stops at end of file.</div>
              <div style={{ marginTop: 8 }}>Codec: H.264 + AAC</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={btnStyle(false)}>Cancel</button>
              <button onClick={startRender} disabled={!ffmpegAvailable} style={btnStyle(true)}>
                Start Recording
              </button>
            </div>
          </>
        )}

        {phase === "rendering" && (
          <>
            <div style={{ fontSize: 11, color: colors.levelOver, marginBottom: 8, fontFamily: "monospace", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors.levelOver, display: "inline-block" }} />
              REC
            </div>
            <div style={{ height: 6, background: colors.bgPrimary, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${colors.accent}, ${colors.levelOk})`, borderRadius: 3, transition: "width 0.3s ease" }} />
            </div>
            <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 12, fontFamily: "monospace" }}>
              {frameCount} frames (expect {Math.round(duration * 60)}) | {Math.floor(position)}s / {Math.floor(duration)}s | {pct}% | {position > 0 ? Math.round(frameCount / position) : 0} fps
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={handleCancel} style={btnStyle(false)}>Cancel</button>
            </div>
          </>
        )}

        {phase === "encoding" && (
          <div style={{ fontSize: 12, color: colors.textDim, fontFamily: "monospace", padding: "8px 0" }}>
            Finalizing video...
          </div>
        )}

        {phase === "complete" && (
          <>
            <p style={{ color: colors.levelOk, fontSize: 13, marginBottom: 8, fontFamily: "monospace" }}>
              Render complete!
            </p>
            <p style={{ color: colors.textDim, fontSize: 11, marginBottom: 16, fontFamily: "monospace" }}>
              {frameCount} frames | {Math.floor(duration)}s
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onClose} style={btnStyle(true)}>Close</button>
            </div>
          </>
        )}

        {phase === "cancelled" && (
          <>
            <p style={{ color: colors.levelWarn, fontSize: 13, marginBottom: 16, fontFamily: "monospace" }}>Recording cancelled.</p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onClose} style={btnStyle(false)}>Close</button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <p style={{ color: colors.levelOver, fontSize: 12, marginBottom: 16, fontFamily: "monospace" }}>{error || "Render failed"}</p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onClose} style={btnStyle(false)}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
