// BarList — horizontal bar list: label · bar · value (right).
//
// Bars fill proportionally to max(items) unless an explicit `max` prop is
// passed. Mono numerals on the right.

import "./BarList.css";

export interface BarListItem {
  label: string;
  value: number;
  sub?: string;
}

export interface BarListProps {
  items: BarListItem[];
  max?: number;
  valueFormat?: (n: number) => string;
  /** Color of the bar fill. Defaults to --accent. */
  color?: string;
  /** Empty fallback line. */
  emptyLabel?: string;
}

export function BarList({
  items,
  max,
  valueFormat = (n) => String(n),
  color = "var(--accent)",
  emptyLabel = "No data",
}: BarListProps) {
  if (!items.length) {
    return <div className="w-barlist-empty">{emptyLabel}</div>;
  }
  const computed = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="w-barlist" role="list">
      {items.map((it, i) => {
        const pct = computed > 0 ? Math.max(0, Math.min(100, (it.value / computed) * 100)) : 0;
        return (
          <li key={`${it.label}-${i}`} className="w-barlist-row">
            <div className="w-barlist-row-h">
              <span className="w-barlist-label" title={it.label}>{it.label || "—"}</span>
              <span className="w-barlist-value">{valueFormat(it.value)}</span>
            </div>
            <div className="w-barlist-track">
              <div className="w-barlist-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            {it.sub ? <div className="w-barlist-sub">{it.sub}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
