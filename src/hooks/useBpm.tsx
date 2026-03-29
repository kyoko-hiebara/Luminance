import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from "react";

interface BpmCtx {
  bpm: number;
  bpmRef: React.MutableRefObject<number>;
  setBpm: (v: number) => void;
  beatOffset: number;
  beatOffsetRef: React.MutableRefObject<number>;
  setBeatOffset: (v: number) => void;
}

const BpmContext = createContext<BpmCtx>({
  bpm: 128,
  bpmRef: { current: 128 },
  setBpm: () => {},
  beatOffset: 0,
  beatOffsetRef: { current: 0 },
  setBeatOffset: () => {},
});

export function BpmProvider({ children }: { children: ReactNode }) {
  const [bpm, setBpmState] = useState(128);
  const bpmRef = useRef(128);
  const [beatOffset, setBeatOffsetState] = useState(0);
  const beatOffsetRef = useRef(0);

  const setBpm = useCallback((v: number) => {
    const clamped = Math.max(30, Math.min(300, v));
    bpmRef.current = clamped;
    setBpmState(clamped);
  }, []);

  const setBeatOffset = useCallback((v: number) => {
    beatOffsetRef.current = v;
    setBeatOffsetState(v);
  }, []);

  return (
    <BpmContext.Provider value={{ bpm, bpmRef, setBpm, beatOffset, beatOffsetRef, setBeatOffset }}>
      {children}
    </BpmContext.Provider>
  );
}

export function useBpm() {
  return useContext(BpmContext);
}
