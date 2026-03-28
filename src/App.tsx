import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Toolbar } from "@/components/Toolbar";
import { Layout } from "@/components/Layout";
import { BpmProvider } from "@/hooks/useBpm";
import { VjTextProvider } from "@/hooks/useVjText";
import { colors } from "@/lib/colors";

interface DragDropEvent {
  paths: string[];
  position: { x: number; y: number };
}

const AUDIO_EXTS = ["wav", "mp3", "flac", "ogg", "aac", "m4a", "wma", "aiff", "aif"];

function isAudioFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTS.includes(ext);
}

export default function App() {
  const [isDragging, setIsDragging] = useState(false);
  // Expose a callback for Toolbar to handle file loading
  const [onDropFile, setOnDropFile] = useState<((path: string) => void) | null>(null);

  const registerDropHandler = useCallback((handler: (path: string) => void) => {
    setOnDropFile(() => handler);
  }, []);

  useEffect(() => {
    let unlistenDrop: (() => void) | null = null;
    let unlistenHover: (() => void) | null = null;
    let unlistenCancel: (() => void) | null = null;

    const setup = async () => {
      unlistenHover = await listen<DragDropEvent>("tauri://drag-over", () => {
        setIsDragging(true);
      });

      unlistenCancel = await listen("tauri://drag-leave", () => {
        setIsDragging(false);
      });

      unlistenDrop = await listen<DragDropEvent>("tauri://drag-drop", (event) => {
        setIsDragging(false);
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          const audioFile = paths.find(isAudioFile);
          if (audioFile && onDropFile) {
            onDropFile(audioFile);
          }
        }
      });
    };

    setup();
    return () => {
      unlistenDrop?.();
      unlistenHover?.();
      unlistenCancel?.();
    };
  }, [onDropFile]);

  return (
    <BpmProvider>
    <VjTextProvider>
      <div className="flex flex-col h-screen bg-bg-primary relative">
        <Toolbar onRegisterDropHandler={registerDropHandler} />
        <Layout />

        {/* Drop overlay */}
        {isDragging && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(139,92,246,0.12)",
              border: `3px dashed ${colors.accent}`,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 999,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontFamily: "monospace",
                fontWeight: "bold",
                color: colors.accent,
                textShadow: `0 0 20px ${colors.accent}88`,
                padding: "16px 32px",
                background: "rgba(28,28,46,0.9)",
                borderRadius: 8,
              }}
            >
              Drop audio file here
            </div>
          </div>
        )}
      </div>
    </VjTextProvider>
    </BpmProvider>
  );
}
