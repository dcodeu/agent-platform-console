// Heatmap — pure SVG 2D heatmap (hour × day-of-week, or any x/y axes).
//
// Width is observed via ResizeObserver so the grid adapts to its container.
// Height is fixed by prop (default 220px). Cells are colored by intensity
// (0..max) using `--accent` at varying alpha. Empty cells are dim.

import { useEffect, useMemo, useRef, useState } from "react";
import "./Heatmap.css";

export interface HeatmapCell {
  x: number;
  y: number;
  value: number;
}

export interface HeatmapProps {
  cells: HeatmapCell[];
  xLabels: string[];
  yLabels: string[];
  valueFormat?: (n: number) => string;
  height?: number;
  ariaLabel?: string;
}

interface HoverState {
  x: number;
  y: number;
  px: number;
  py: number;
  value: number;
}

export function Heatmap({
  cells,
  xLabels,
  yLabels,
  valueFormat = (n) => String(Math.round(n)),
  height = 220,
  ariaLabel,
}: HeatmapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.max(180, Math.floor(entry.contentRect.width)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pad reserves space for axis labels.
  const pad = { l: 32, r: 8, t: 6, b: 22 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = Math.max(10, height - pad.t - pad.b);
  const cols = Math.max(1, xLabels.length);
  const rows = Math.max(1, yLabels.length);
  const cellW = innerW / cols;
  const cellH = innerH / rows;

  // Lookup grid for fast tooltip/render.
  const { grid, maxVal } = useMemo(() => {
    const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    let max = 0;
    for (const c of cells) {
      if (c.x < 0 || c.x >= cols || c.y < 0 || c.y >= rows) continue;
      grid[c.y][c.x] = c.value;
      if (c.value > max) max = c.value;
    }
    return { grid, maxVal: max };
  }, [cells, cols, rows]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const lx = e.clientX - rect.left - pad.l;
    const ly = e.clientY - rect.top - pad.t;
    if (lx < 0 || ly < 0 || lx > innerW || ly > innerH) {
      setHover(null);
      return;
    }
    const xi = Math.min(cols - 1, Math.max(0, Math.floor(lx / cellW)));
    const yi = Math.min(rows - 1, Math.max(0, Math.floor(ly / cellH)));
    setHover({
      x: xi,
      y: yi,
      px: pad.l + xi * cellW + cellW / 2,
      py: pad.t + yi * cellH + cellH / 2,
      value: grid[yi][xi] ?? 0,
    });
  }
  function onLeave() { setHover(null); }

  // X label thinning — when cells are narrow, show every Nth label.
  const xStep = cellW >= 30 ? 1 : cellW >= 18 ? 2 : cellW >= 12 ? 3 : 4;

  return (
    <div className="w-heat" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {/* Cells */}
        {grid.map((row, yi) =>
          row.map((value, xi) => {
            const t = maxVal > 0 ? value / maxVal : 0;
            // Slight gamma so mid-values pop a bit.
            const alpha = value === 0 ? 0.06 : 0.16 + Math.pow(t, 0.7) * 0.84;
            const fill =
              value === 0
                ? "var(--bg-2)"
                : `rgba(43, 198, 188, ${alpha.toFixed(3)})`;
            return (
              <rect
                key={`${yi}-${xi}`}
                x={pad.l + xi * cellW + 1}
                y={pad.t + yi * cellH + 1}
                width={Math.max(0, cellW - 2)}
                height={Math.max(0, cellH - 2)}
                rx="1.5"
                fill={fill}
              />
            );
          }),
        )}
        {/* Y labels (row names) */}
        {yLabels.map((lbl, yi) => (
          <text
            key={`yl-${yi}`}
            x={pad.l - 6}
            y={pad.t + yi * cellH + cellH / 2 + 3.5}
            textAnchor="end"
            className="w-heat-axis"
          >
            {lbl}
          </text>
        ))}
        {/* X labels (col names) — thinned for narrow cells */}
        {xLabels.map((lbl, xi) =>
          xi % xStep === 0 ? (
            <text
              key={`xl-${xi}`}
              x={pad.l + xi * cellW + cellW / 2}
              y={height - 6}
              textAnchor="middle"
              className="w-heat-axis"
            >
              {lbl}
            </text>
          ) : null,
        )}
        {/* Hover highlight ring */}
        {hover ? (
          <rect
            x={pad.l + hover.x * cellW + 1}
            y={pad.t + hover.y * cellH + 1}
            width={Math.max(0, cellW - 2)}
            height={Math.max(0, cellH - 2)}
            rx="1.5"
            fill="none"
            stroke="var(--fg)"
            strokeWidth="1.5"
            pointerEvents="none"
          />
        ) : null}
      </svg>
      {hover ? (
        <div
          className="w-heat-tip"
          style={{
            left: Math.min(width - 160, Math.max(0, hover.px + 10)),
            top: Math.max(0, hover.py - 28),
          }}
        >
          <span className="w-heat-tip-x">{xLabels[hover.x]}</span>
          <span className="w-heat-tip-y"> · {yLabels[hover.y]}</span>
          <span className="w-heat-tip-v">{valueFormat(hover.value)}</span>
        </div>
      ) : null}
    </div>
  );
}
