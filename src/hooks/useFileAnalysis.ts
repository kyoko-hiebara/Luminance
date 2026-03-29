import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface FileAnalysis {
  peak_l_db: number;
  peak_r_db: number;
  rms_l_db: number;
  rms_r_db: number;
  dynamic_range_db: number;
  density_p10: number;
  density_p50: number;
  density_p90: number;
  density_max: number;
  integrated_loudness_estimate: number;
  sample_rate: number;
  duration_secs: number;
  detected_bpm: number;
  beat_offset_secs: number;
}

/**
 * Listen for file-analysis events. Returns a ref to the latest analysis.
 * Calls onAnalysis callback when new data arrives (for triggering state updates).
 */
export function useFileAnalysis(
  onAnalysis?: (data: FileAnalysis | null) => void
): React.MutableRefObject<FileAnalysis | null> {
  const dataRef = useRef<FileAnalysis | null>(null);
  const callbackRef = useRef(onAnalysis);
  callbackRef.current = onAnalysis;

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    const setup = async () => {
      unlisten = await listen<FileAnalysis | null>("file-analysis", (event) => {
        dataRef.current = event.payload;
        callbackRef.current?.(event.payload);
      });
    };
    setup();
    return () => { if (unlisten) unlisten(); };
  }, []);

  return dataRef;
}
