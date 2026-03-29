import { useRef, useCallback, useEffect, type CSSProperties } from "react";
import { colors } from "@/lib/colors";

interface Props {
  value: number; // 0..1
  onChange: (value: number) => void;
  gradient?: string;
}

const defaultGradient = `linear-gradient(90deg, ${colors.accent}, #3EDEF7, #A3D9D9, #D89F58, #E2B0A5)`;

export function NeonSlider({ value, onChange, gradient }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const computeValue = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left;
      onChange(Math.max(0, Math.min(1, x / rect.width)));
    },
    [onChange]
  );

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      dragging.current = true;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      computeValue(clientX);
    },
    [computeValue]
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      computeValue(clientX);
    };
    const handleUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [computeValue]);

  const pct = `${(value * 100).toFixed(1)}%`;

  return (
    <div
      ref={trackRef}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      style={{
        flex: 1,
        height: 14,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        position: "relative",
        touchAction: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 3,
          borderRadius: 1.5,
          background: "#091834",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          width: pct,
          height: 3,
          borderRadius: 1.5,
          background: gradient ?? defaultGradient,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: pct,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: colors.accent,
          transform: "translateX(-50%)",
          boxShadow: `0 0 6px ${colors.accent}88, 0 0 2px ${colors.accent}44`,
        }}
      />
    </div>
  );
}

// --- Dual-thumb range slider ---

interface RangeProps {
  low: number;  // 0..1
  high: number; // 0..1
  onChangeLow: (v: number) => void;
  onChangeHigh: (v: number) => void;
  gradient?: string;
}

const thumbStyle: CSSProperties = {
  position: "absolute",
  width: 10,
  height: 10,
  borderRadius: "50%",
  background: colors.accent,
  transform: "translateX(-50%)",
  boxShadow: `0 0 6px ${colors.accent}88, 0 0 2px ${colors.accent}44`,
  zIndex: 2,
};

export function NeonRangeSlider({ low, high, onChangeLow, onChangeHigh, gradient }: RangeProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const activeThumb = useRef<"low" | "high" | null>(null);

  const getPosition = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const pos = getPosition(clientX);

      // Pick the closer thumb
      const distLow = Math.abs(pos - low);
      const distHigh = Math.abs(pos - high);
      activeThumb.current = distLow <= distHigh ? "low" : "high";

      if (activeThumb.current === "low") {
        onChangeLow(Math.min(pos, high - 0.01));
      } else {
        onChangeHigh(Math.max(pos, low + 0.01));
      }
    },
    [getPosition, low, high, onChangeLow, onChangeHigh]
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!activeThumb.current) return;
      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const pos = getPosition(clientX);

      if (activeThumb.current === "low") {
        onChangeLow(Math.min(pos, high - 0.01));
      } else {
        onChangeHigh(Math.max(pos, low + 0.01));
      }
    };
    const handleUp = () => {
      activeThumb.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [getPosition, low, high, onChangeLow, onChangeHigh]);

  const lowPct = `${(low * 100).toFixed(1)}%`;
  const highPct = `${(high * 100).toFixed(1)}%`;

  return (
    <div
      ref={trackRef}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      style={{
        flex: 1,
        height: 14,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        position: "relative",
        touchAction: "none",
      }}
    >
      {/* Track background */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 3,
          borderRadius: 1.5,
          background: "#091834",
        }}
      />
      {/* Filled range between thumbs */}
      <div
        style={{
          position: "absolute",
          left: lowPct,
          width: `${((high - low) * 100).toFixed(1)}%`,
          height: 3,
          borderRadius: 1.5,
          background: gradient ?? defaultGradient,
        }}
      />
      {/* Low thumb */}
      <div style={{ ...thumbStyle, left: lowPct }} />
      {/* High thumb */}
      <div style={{ ...thumbStyle, left: highPct }} />
    </div>
  );
}
