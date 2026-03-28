import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { colors } from "@/lib/colors";
import { useBpm } from "@/hooks/useBpm";
import { RenderDialog } from "@/components/RenderDialog";
import type { AudioData } from "@/hooks/useAudioData";

interface AudioDevice {
  name: string;
  is_default: boolean;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Toolbar() {
  const { bpm, setBpm } = useBpm();
  const [bpmDraft, setBpmDraft] = useState(String(bpm));
  const bpmInputRef = useRef<HTMLInputElement>(null);

  const commitBpm = useCallback(() => {
    const parsed = parseInt(bpmDraft);
    if (!isNaN(parsed) && parsed >= 30 && parsed <= 300) {
      setBpm(parsed);
      setBpmDraft(String(parsed));
    } else {
      setBpmDraft(String(bpm));
    }
  }, [bpmDraft, bpm, setBpm]);

  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFileMode, setIsFileMode] = useState(false);
  const [showRender, setShowRender] = useState(false);
  const [currentAudioPath, setCurrentAudioPath] = useState("");

  // Transport state — updated at ~4fps to avoid re-render storms
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLooping, setIsLooping] = useState(false);

  // Refs for high-frequency data and throttling
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const isPausedRef = useRef(false);
  const isLoopingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const lastStateUpdateRef = useRef(0);

  // Listen to audio-data events for transport info
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<AudioData>("audio-data", (event) => {
        const transport = event.payload.transport;
        if (!transport) return;

        // Always update refs (no re-render cost)
        if (!isDraggingRef.current) {
          positionRef.current = transport.position_secs;
        }
        durationRef.current = transport.duration_secs;
        isPausedRef.current = transport.is_paused;
        isLoopingRef.current = transport.is_looping;

        // Throttle React state updates to ~4fps (every 250ms)
        const now = Date.now();
        if (now - lastStateUpdateRef.current >= 250) {
          lastStateUpdateRef.current = now;
          if (!isDraggingRef.current) {
            setPosition(transport.position_secs);
          }
          setDuration(transport.duration_secs);
          setIsPaused(transport.is_paused);
          setIsLooping(transport.is_looping);
        }
      });
    };

    setup();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const loadDevices = async () => {
    const devs = await invoke<AudioDevice[]>("get_audio_devices");
    setDevices(devs);
  };

  const startMic = async (deviceName?: string) => {
    setIsLoading(true);
    try {
      await invoke("start_mic_capture", { deviceName: deviceName ?? null });
      setActiveSource(deviceName ?? "Default Mic");
      setIsFileMode(false);
    } catch (e) {
      console.error("Failed to start mic:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const openFile = async () => {
    const file = await open({
      multiple: false,
      filters: [
        {
          name: "Audio",
          extensions: ["wav", "mp3", "flac", "ogg", "aac", "m4a"],
        },
      ],
    });

    if (file) {
      setIsLoading(true);
      try {
        await invoke("open_audio_file", { path: file });
        const name = typeof file === "string" ? file.split("/").pop() ?? file : "file";
        setActiveSource(name);
        setIsFileMode(true);
        setCurrentAudioPath(file as string);
      } catch (e) {
        console.error("Failed to open file:", e);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const stopAudio = async () => {
    await invoke("stop_audio");
    setActiveSource(null);
    setIsFileMode(false);
    setPosition(0);
    setDuration(0);
    setIsPaused(false);
    setIsLooping(false);
  };

  const handlePlayPause = useCallback(async () => {
    try {
      const nowPaused = await invoke<boolean>("play_pause");
      setIsPaused(nowPaused);
      isPausedRef.current = nowPaused;
    } catch (e) {
      console.error("Failed to toggle play/pause:", e);
    }
  }, []);

  const handleLoopToggle = useCallback(async () => {
    const newLooping = !isLoopingRef.current;
    try {
      await invoke("set_looping", { enabled: newLooping });
      setIsLooping(newLooping);
      isLoopingRef.current = newLooping;
    } catch (e) {
      console.error("Failed to toggle looping:", e);
    }
  }, []);

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    positionRef.current = value;
    setPosition(value);
  }, []);

  const handleSeekStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleSeekEnd = useCallback(async (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    isDraggingRef.current = false;
    const target = e.target as HTMLInputElement;
    const value = parseFloat(target.value);
    try {
      await invoke("seek", { positionSecs: value });
    } catch (err) {
      console.error("Failed to seek:", err);
    }
  }, []);

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-b border-border-panel bg-bg-panel"
      style={{ boxShadow: "0 1px 8px rgba(0,0,0,0.4)" }}
    >
      <span
        className="text-sm font-bold text-accent tracking-wide"
        style={{ textShadow: "0 0 10px rgba(139,92,246,0.5)" }}
      >
        LUMINANCE
      </span>

      <div className="w-px h-5 bg-border-panel" />

      <button
        onClick={openFile}
        disabled={isLoading}
        className="px-3 py-1 text-xs text-text-primary hover:bg-grid transition-colors disabled:opacity-50"
        style={{ borderRadius: 4, backgroundColor: "#1e1e2e", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        Open File
      </button>

      <div
        className="flex items-center gap-1"
        style={{
          backgroundColor: "rgba(255,255,255,0.03)",
          borderRadius: 4,
          padding: "2px 6px",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontFamily: "monospace",
            color: colors.textDim,
          }}
        >
          BPM
        </span>
        <input
          ref={bpmInputRef}
          type="text"
          inputMode="numeric"
          value={bpmDraft}
          onChange={(e) => setBpmDraft(e.target.value)}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitBpm();
              bpmInputRef.current?.blur();
            } else if (e.key === "Escape") {
              setBpmDraft(String(bpm));
              bpmInputRef.current?.blur();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.shiftKey ? 10 : 1;
              const next = Math.min(300, bpm + step);
              setBpm(next);
              setBpmDraft(String(next));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const step = e.shiftKey ? 10 : 1;
              const next = Math.max(30, bpm - step);
              setBpm(next);
              setBpmDraft(String(next));
            }
          }}
          style={{
            width: 36,
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: "bold",
            background: colors.bgPrimary,
            color: colors.textPrimary,
            border: `1px solid ${colors.borderPanel}`,
            borderRadius: 3,
            padding: "2px 4px",
            textAlign: "center",
            outline: "none",
          }}
        />
      </div>

      <div className="relative">
        <button
          onClick={async () => {
            await loadDevices();
            if (devices.length > 0) {
              const defaultDev = devices.find((d) => d.is_default);
              await startMic(defaultDev?.name);
            } else {
              await startMic();
            }
          }}
          disabled={isLoading}
          className="px-3 py-1 text-xs text-text-primary hover:bg-grid transition-colors disabled:opacity-50"
          style={{ borderRadius: 4, backgroundColor: "#1e1e2e", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          Mic
        </button>
      </div>

      {isFileMode && activeSource && (
        <>
          <div className="w-px h-5 bg-border-panel" />

          <div
            className="flex items-center gap-2"
            style={{
              backgroundColor: "rgba(255,255,255,0.03)",
              borderRadius: 6,
              padding: "3px 8px",
            }}
          >
            {/* Play/Pause */}
            <button
              onClick={handlePlayPause}
              className="px-3 py-1 text-xs rounded bg-border-panel text-text-primary hover:bg-grid transition-colors font-mono"
              title={isPaused ? "Play" : "Pause"}
            >
              {isPaused ? ">" : "||"}
            </button>

            {/* Loop toggle */}
            <button
              onClick={handleLoopToggle}
              className="px-3 py-1 text-xs rounded transition-colors"
              style={
                isLooping
                  ? { backgroundColor: `${colors.accent}33`, color: colors.accent }
                  : { backgroundColor: colors.borderPanel, color: colors.textPrimary }
              }
              title={isLooping ? "Disable loop" : "Enable loop"}
            >
              Loop
            </button>

            {/* Position display */}
            <span className="text-text-dim font-mono text-xs min-w-[3ch] text-right select-none">
              {formatTime(position)}
            </span>

            {/* Seek slider */}
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.01}
              value={position}
              onChange={handleSeekChange}
              onMouseDown={handleSeekStart}
              onMouseUp={handleSeekEnd}
              onTouchStart={handleSeekStart}
              onTouchEnd={handleSeekEnd}
              className="flex-1 h-1 min-w-[80px] max-w-[240px] cursor-pointer"
              style={{ accentColor: colors.accent }}
            />

            {/* Duration display */}
            <span className="text-text-dim font-mono text-xs min-w-[3ch] select-none">
              {formatTime(duration)}
            </span>
          </div>

          <button
            onClick={() => setShowRender(true)}
            className="px-3 py-1 text-xs text-text-primary hover:bg-grid transition-colors"
            style={{ borderRadius: 4, backgroundColor: "#1e1e2e", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            Render
          </button>
        </>
      )}

      {activeSource && (
        <>
          <div className="w-px h-5 bg-border-panel" />
          <button
            onClick={stopAudio}
            className="px-3 py-1 text-xs rounded text-level-over hover:bg-level-over/30 transition-colors"
            style={{ border: "1px solid rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.1)" }}
          >
            Stop
          </button>
          <span className="text-xs text-text-dim truncate max-w-48">{activeSource}</span>
        </>
      )}

      {showRender && (
        <RenderDialog
          audioPath={currentAudioPath}
          onClose={() => setShowRender(false)}
        />
      )}
    </div>
  );
}
