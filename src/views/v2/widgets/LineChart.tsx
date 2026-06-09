// LineChart — pure SVG multi-series line chart with axes, legend, hover.
//
// No library. Width is observed via ResizeObserver so the chart adapts to
// container size; height is fixed by prop (default 200).

import { useEffect, useMemo, useRef, useState } from "react";
import { displayMetricLabel } from "../data/display.ts";
import "./LineChart.css";

export interface LineSeries {
  name: string;
  color?: string;
  /** [x, y] tuples — x is typically epoch ms; y is data value. */
  points: Array<[number, number]>;
  /** If true, render as dashed (used for "shadow" or secondary series). */
  dashed?: boolean;
}

export interface LineChartProps {
  series: LineSeries[];
  height?: number;
  yFormat?: (n: number) => string;
  xFormat?: (n: number) => string;
  ariaLabel?: string;
  /** Show grid lines. Default true. */
  grid?: boolean;
  /** Show legend chips below chart. Default true. */
  legend?: boolean;
  /**
   * Force the Y axis domain. When set, disables auto-fit + 6% padding. Useful
   * for ratios/percentages that should never visually overshoot 100%.
   */
  yDomain?: [number, number];
}

const DEFAULT_COLORS = [
  "var(--accent)",
  "var(--attn)",
  "var(--viz-dim)",
  "var(--fg-2)",
  "var(--alert)",
];

interface HoverState {
  x: number; // pixel within svg
  dataX: number; // logical x
  values: Array<{ name: string; color: string; value: number }>;
}

export function LineChart({
  series,
  height = 200,
  yFormat = (n) => String(Math.round(n)),
  xFormat,
  ariaLabel,
  grid = true,
  legend = true,
  yDomain,
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.max(120, Math.floor(entry.contentRect.width)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 44, r: 14, t: 8, b: 24 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = Math.max(10, height - pad.t - pad.b);

  const { xMin, xMax, yMin, yMax, paths, allPoints } = useMemo(() => {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of series) {
      for (const [x, y] of s.points) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (!Number.isFinite(xMin)) {
      xMin = 0; xMax = 1; yMin = 0; yMax = 1;
    }
    if (yMin === yMax) { yMin = yMin - 1; yMax = yMax + 1; }
    if (xMin === xMax) { xMax = xMin + 1; }
    if (yDomain) {
      // Caller forced the Y domain — skip padding so 100% maps to the top edge.
      yMin = yDomain[0];
      yMax = yDomain[1];
    } else {
      // Pad y range 6% above max so the top line isn't flush with the edge.
      const ySpan = yMax - yMin;
      yMax = yMax + ySpan * 0.06;
      yMin = Math.max(0, yMin - ySpan * 0.02);
    }
    const xToPx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * innerW;
    const yToPx = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * innerH;
    const paths = series.map((s) => ({
      ...s,
      d: s.points
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${xToPx(x).toFixed(2)},${yToPx(y).toFixed(2)}`)
        .join(" "),
    }));
    const allPoints = series.flatMap((s, si) =>
      s.points.map(([x, y]) => ({ x, y, si, name: s.name, color: s.color ?? DEFAULT_COLORS[si % DEFAULT_COLORS.length] })),
    );
    return { xMin, xMax, yMin, yMax, paths, allPoints };
  }, [series, innerW, innerH, yDomain]);

  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const t = i / yTicks;
    const v = yMin + (yMax - yMin) * (1 - t);
    const py = pad.t + t * innerH;
    return { v, py };
  });

  const xTicks = 5;
  const xLabels = Array.from({ length: xTicks + 1 }, (_, i) => {
    const t = i / xTicks;
    const v = xMin + (xMax - xMin) * t;
    const px = pad.l + t * innerW;
    return { v, px };
  });

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < pad.l || px > pad.l + innerW) {
      setHover(null);
      return;
    }
    const dataX = xMin + ((px - pad.l) / innerW) * (xMax - xMin);
    const values = series.map((s, si) => {
      // Find nearest sample by x.
      let nearest: [number, number] | null = null;
      let best = Infinity;
      for (const p of s.points) {
        const d = Math.abs(p[0] - dataX);
        if (d < best) { best = d; nearest = p; }
      }
      return {
        name: s.name,
        color: s.color ?? DEFAULT_COLORS[si % DEFAULT_COLORS.length],
        value: nearest ? nearest[1] : 0,
      };
    });
    setHover({ x: px, dataX, values });
  }
  function onLeave() { setHover(null); }

  const hasData = allPoints.length > 0;

  return (
    <div className="w-line" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {grid && yLabels.map((t, i) => (
          <line
            key={`gy-${i}`}
            x1={pad.l}
            x2={pad.l + innerW}
            y1={t.py}
            y2={t.py}
            stroke="var(--rule)"
            strokeWidth="1"
            strokeDasharray={i === yLabels.length - 1 ? undefined : "2 4"}
          />
        ))}
        {yLabels.map((t, i) => (
          <text
            key={`yl-${i}`}
            x={pad.l - 8}
            y={t.py + 3.5}
            textAnchor="end"
            className="w-line-axis"
          >
            {yFormat(t.v)}
          </text>
        ))}
        {xLabels.map((t, i) => (
          <text
            key={`xl-${i}`}
            x={t.px}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
            className="w-line-axis"
          >
            {xFormat ? xFormat(t.v) : ""}
          </text>
        ))}
        {paths.map((p, i) => (
          <path
            key={`p-${i}`}
            d={p.d}
            fill="none"
            stroke={p.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
            strokeWidth="1.5"
            strokeDasharray={p.dashed ? "3 3" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {hover && hasData ? (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={pad.t}
            y2={pad.t + innerH}
            stroke="var(--fg-3)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        ) : null}
      </svg>
      {hover && hasData ? (
        <div
          className="w-line-tip"
          style={{
            left: Math.min(width - 160, Math.max(0, hover.x + 8)),
          }}
        >
          <div className="w-line-tip-x">
            {xFormat ? xFormat(hover.dataX) : ""}
          </div>
          {hover.values.map((v) => (
            <div key={v.name} className="w-line-tip-row">
              <span className="w-line-tip-dot" style={{ background: v.color }} />
              <span className="w-line-tip-name">{displayMetricLabel(v.name)}</span>
              <span className="w-line-tip-val">{yFormat(v.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {legend ? (
        <div className="w-line-legend">
          {series.map((s, i) => (
            <span key={s.name} className="w-line-legend-i">
              <span
                className="w-line-legend-dot"
                style={{ background: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] }}
              />
              {displayMetricLabel(s.name)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
