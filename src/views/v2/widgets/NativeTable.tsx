// NativeTable — simple tabular widget with column formatters.
//
// Used for ranked lists like "Top 50 costly invocations". Keeps the same
// visual language as .ag-table (mono headers, dim caption rows) but renders
// from a flat { columns, rows } shape so it stays generic.

import type { ReactNode } from "react";
import "./NativeTable.css";

export interface NativeTableColumn<R = Record<string, unknown>> {
  key: string;
  label: string;
  format?: (value: unknown, row: R) => ReactNode;
  align?: "left" | "right";
  /** Add the dim mono treatment used for secondary cells. */
  dim?: boolean;
  width?: string;
}

export interface NativeTableProps<R extends Record<string, unknown> = Record<string, unknown>> {
  columns: Array<NativeTableColumn<R>>;
  rows: R[];
  /** Vertical max — enables internal scroll. */
  maxHeight?: number;
  density?: "compact" | "comfortable";
  emptyLabel?: string;
  ariaLabel?: string;
}

export function NativeTable<R extends Record<string, unknown> = Record<string, unknown>>({
  columns,
  rows,
  maxHeight,
  density = "comfortable",
  emptyLabel = "No data",
  ariaLabel,
}: NativeTableProps<R>) {
  if (!rows.length) {
    return <div className="w-tbl-empty">{emptyLabel}</div>;
  }
  return (
    <div
      className={`w-tbl-wrap${maxHeight ? " is-scroll" : ""}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table
        className={`w-tbl w-tbl-${density}`}
        aria-label={ariaLabel}
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: c.align ?? "left", width: c.width }}
                scope="col"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const raw = row[c.key];
                const rendered = c.format ? c.format(raw, row) : (raw == null ? "—" : String(raw));
                return (
                  <td
                    key={c.key}
                    style={{ textAlign: c.align ?? "left" }}
                    className={c.dim ? "w-tbl-dim" : undefined}
                  >
                    {rendered}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
