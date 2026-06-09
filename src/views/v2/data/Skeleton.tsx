// Skeleton — single-purpose shimmer block used by the KPI tiles while
// data is in-flight. Uses --fg-3 (dim mono color) as the base, animated by
// the y2-skeleton keyframes in Skeleton.css.

import "./Skeleton.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  inline?: boolean;
  className?: string;
}

export function Skeleton({ width, height, inline, className }: SkeletonProps) {
  return (
    <span
      className={`y2-skeleton${inline ? " y2-skeleton-inline" : ""}${className ? ` ${className}` : ""}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
      aria-hidden="true"
    />
  );
}
