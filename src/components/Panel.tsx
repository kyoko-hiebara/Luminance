import { useRef, useEffect, useState, type ReactNode } from "react";

interface Props {
  title: string;
  hideTitle?: boolean;
  children: (size: { width: number; height: number }) => ReactNode;
}

export function Panel({ title, hideTitle, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-panel
      className="flex flex-col h-full rounded-lg border border-border-panel bg-bg-panel overflow-hidden"
      style={{ boxShadow: "0 0 16px rgba(195,63,69,0.06), 0 2px 6px rgba(0,0,0,0.4)" }}
    >
      {!hideTitle && (
        <div
          data-panel-title={title}
          className="flex items-center px-3 py-1.5 border-b border-border-panel"
          style={{ background: "linear-gradient(to right, #0e2245, transparent)" }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0"
            style={{
              backgroundColor: "rgba(195,63,69,0.6)",
              boxShadow: "0 0 4px rgba(195,63,69,0.4)",
            }}
          />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{
              color: "#B7C5F4",
              textShadow: "0 0 12px rgba(127,158,237,0.55), 0 0 4px rgba(195,63,69,0.35), 0 0 1px rgba(255,255,255,0.2)",
            }}
          >
            {title}
          </span>
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {size.width > 0 && size.height > 0 && children(size)}
      </div>
    </div>
  );
}
