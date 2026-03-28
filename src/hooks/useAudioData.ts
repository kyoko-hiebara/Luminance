import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface AudioData {
  spectrum: {
    magnitudes: number[];
    peaks: number[];
  };
  levels: {
    rms_l: number;
    rms_r: number;
    peak_l: number;
    peak_r: number;
  };
  waveform: {
    samples_l: number[];
    samples_r: number[];
    band_l: [number, number, number];
    band_r: [number, number, number];
    band_s: [number, number, number];
  };
  stereo: {
    correlation: number;
    lissajous_l: number[];
    lissajous_r: number[];
  };
  loudness: {
    momentary: number;
    short_term: number;
  };
  spectrogram_frame: number[];
  transport: {
    position_secs: number;
    duration_secs: number;
    is_paused: boolean;
    is_looping: boolean;
  } | null;
}

/**
 * Hook to listen to Tauri audio data events.
 * Stores data in a ref to avoid React re-renders.
 */
export function useAudioData(
  eventName: string,
  callback: (data: AudioData) => void
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<AudioData>(eventName, (event) => {
        callbackRef.current(event.payload);
      });
    };

    setup();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [eventName]);
}
