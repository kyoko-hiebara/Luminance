import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from "react";

interface VjTextCtx {
  text: string;
  textRef: React.MutableRefObject<string>;
  setText: (v: string) => void;
}

const VjTextContext = createContext<VjTextCtx>({
  text: "",
  textRef: { current: "" },
  setText: () => {},
});

export function VjTextProvider({ children }: { children: ReactNode }) {
  const [text, setTextState] = useState("");
  const textRef = useRef("");

  const setText = useCallback((v: string) => {
    textRef.current = v;
    setTextState(v);
  }, []);

  return (
    <VjTextContext.Provider value={{ text, textRef, setText }}>
      {children}
    </VjTextContext.Provider>
  );
}

export function useVjText() {
  return useContext(VjTextContext);
}
