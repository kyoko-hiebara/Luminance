import { useEffect, useRef } from "react";

/**
 * Hook that runs a callback on every requestAnimationFrame.
 * Properly cleans up on unmount.
 */
export function useAnimationFrame(callback: (deltaTime: number) => void) {
  const callbackRef = useRef(callback);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  callbackRef.current = callback;

  useEffect(() => {
    const animate = (time: number) => {
      const delta = lastTimeRef.current ? time - lastTimeRef.current : 0;
      lastTimeRef.current = time;
      callbackRef.current(delta);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);
}
