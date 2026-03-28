import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from "react";

interface BpmCtx {
  bpm: number;
  bpmRef: React.MutableRefObject<number>;
  setBpm: (v: number) => void;
}

const BpmContext = createContext<BpmCtx>({
  bpm: 128,
  bpmRef: { current: 128 },
  setBpm: () => {},
});

export function BpmProvider({ children }: { children: ReactNode }) {
  const [bpm, setBpmState] = useState(128);
  const bpmRef = useRef(128);

  const setBpm = useCallback((v: number) => {
    const clamped = Math.max(30, Math.min(300, v));
    bpmRef.current = clamped;
    setBpmState(clamped);
  }, []);

  return (
    <BpmContext.Provider value={{ bpm, bpmRef, setBpm }}>
      {children}
    </BpmContext.Provider>
  );
}

export function useBpm() {
  return useContext(BpmContext);
}
