// MiniBars — vertical mini bar histogram (e.g. hourly invocations).

import "./MiniBars.css";

export interface MiniBarsProps {
  bars: number[];
  height?: number;
  color?: string;
  ariaLabel?: string;
  /** Optional renderer for value tooltip. */
  titleFor?: (value: number, index: number) => string;
}

export function MiniBars({
  bars,
  height = 48,
  color = "var(--accent)",
  ariaLabel,
  titleFor,
}: MiniBarsProps) {
  if (!bars.length) {
    return <div className="w-minibars-empty">no data</div>;
  }
  const max = Math.max(...bars, 1);
  return (
    <div
      className="w-minibars"
      style={{ height }}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
    >
      {bars.map((v, i) => {
        const h = max > 0 ? Math.max(2, (v / max) * height) : 0;
        return (
          <span
            key={i}
            className="w-minibars-b"
            style={{ height: h, background: color }}
            title={titleFor ? titleFor(v, i) : String(v)}
          />
        );
      })}
    </div>
  );
}
