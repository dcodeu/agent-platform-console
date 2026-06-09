// Gauge — semi-circular gauge for 0..1 ratios.
//
// Thresholds default to ok>=0.7, warn>=0.5, alert<0.5. Pure SVG arc math.

import "./Gauge.css";

export interface GaugeThresholds {
  ok: number;
  warn: number;
  alert: number;
}

export interface GaugeProps {
  value: number;
  max?: number;
  label?: string;
  size?: number;
  thresholds?: GaugeThresholds;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`;
}

export function Gauge({
  value,
  max = 1,
  label,
  size = 140,
  thresholds = { ok: 0.7, warn: 0.5, alert: 0 },
}: GaugeProps) {
  const v = Math.max(0, Math.min(1, value / max));
  const startDeg = -120;
  const endDeg = 120;
  const sweep = endDeg - startDeg;
  const valueDeg = startDeg + sweep * v;
  const color =
    v >= thresholds.ok ? "var(--accent)" : v >= thresholds.warn ? "var(--attn)" : "var(--alert)";
  const cx = size / 2;
  const cy = size / 2 + 8;
  const r = size / 2 - 14;
  const trackPath = arcPath(cx, cy, r, startDeg, endDeg);
  const valuePath = arcPath(cx, cy, r, startDeg, valueDeg);
  const pct = `${(v * 100).toFixed(1)}%`;
  return (
    <div className="w-gauge" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <path d={trackPath} stroke="var(--bg-2)" strokeWidth={10} fill="none" strokeLinecap="round" />
        <path d={valuePath} stroke={color} strokeWidth={10} fill="none" strokeLinecap="round" />
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          className="w-gauge-v"
          fill="var(--fg)"
        >
          {pct}
        </text>
        {label ? (
          <text x={cx} y={cy + 18} textAnchor="middle" className="w-gauge-l" fill="var(--fg-3)">
            {label}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
