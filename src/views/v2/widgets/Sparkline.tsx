// Sparkline — inline SVG line. Pure: no library, no axes, no tooltip.

export interface SparklineProps {
  points: number[];
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
}

export function Sparkline({
  points,
  height = 36,
  stroke = "var(--accent)",
  fill = "var(--accent-bg)",
  ariaLabel,
}: SparklineProps) {
  if (!points.length) {
    return (
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        aria-hidden={ariaLabel ? undefined : true}
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
      />
    );
  }
  const n = points.length;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const w = 100; // viewBox units; preserveAspectRatio="none" will stretch
  const pad = 2;
  const usable = height - pad * 2;
  const xy = points.map((v, i) => {
    const x = (i / Math.max(1, n - 1)) * w;
    const y = pad + (1 - (v - min) / span) * usable;
    return [x, y] as const;
  });
  const path = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const last = xy[xy.length - 1];
  const area = `${path} L${w},${height} L0,${height} Z`;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <path d={area} fill={fill} stroke="none" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {last ? <circle cx={last[0]} cy={last[1]} r="2" fill={stroke} /> : null}
    </svg>
  );
}
