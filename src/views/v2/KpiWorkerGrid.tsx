// KpiWorkerGrid — N small squares showing each worker's state.
//
// Used for "Codex pool". Each worker is `ready` (teal) or `quar` (red). The
// caption below shows ready count + first quarantined worker's id, mirroring
// the sketch's `10 of 11 ready · codex-09 quar` layout.

import "./KpiWorkerGrid.css";

export type WorkerState = "ready" | "quar";

export interface Worker {
  id: string;
  state: WorkerState;
}

export interface KpiWorkerGridProps {
  title: string;
  workers: Worker[];
  /** When set, each square becomes a button that fires onSelect(id). */
  onSelect?: (id: string) => void;
}

export function KpiWorkerGrid({ title, workers, onSelect }: KpiWorkerGridProps) {
  const ready = workers.filter((w) => w.state === "ready").length;
  const firstQuar = workers.find((w) => w.state === "quar");

  return (
    <div className="y2-tile y2-k-grid">
      <header className="y2-tile-h">
        <h3>{title}</h3>
        <span className="y2-tile-src y2-tile-src-g">
          <span className="y2-tile-lbl">scene · stat</span>
        </span>
      </header>
      <div className="y2-tile-b">
        <div
          className="y2-k-grid-workers"
          style={{ gridTemplateColumns: `repeat(${workers.length}, 1fr)` }}
          role="list"
          aria-label={`${workers.length} workers`}
        >
          {workers.map((w) =>
            onSelect ? (
              <button
                key={w.id}
                type="button"
                data-worker-id={w.id}
                className={`y2-k-grid-w y2-k-grid-w-btn${w.state === "quar" ? " y2-k-grid-quar" : ""}`}
                role="listitem"
                aria-label={`${w.id} ${w.state} — open detail`}
                title={`${w.id} · ${w.state} · click for detail`}
                onClick={() => onSelect(w.id)}
              />
            ) : (
              <span
                key={w.id}
                className={`y2-k-grid-w${w.state === "quar" ? " y2-k-grid-quar" : ""}`}
                role="listitem"
                aria-label={`${w.id} ${w.state}`}
                title={`${w.id} · ${w.state}`}
              />
            ),
          )}
        </div>
        <div className="y2-k-grid-row">
          <span className="y2-k-grid-ct">
            <b>{ready}</b> of {workers.length} ready
          </span>
          {firstQuar ? (
            <span className="y2-k-grid-quar-lbl">{firstQuar.id} quar</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
