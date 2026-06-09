const MAX_POINTS = 60;

interface Ring {
  points: number[];
  ts: number[];
}

const rings = new Map<string, Ring>();

export function push(key: string, value: number, ts: number = Date.now()): void {
  let r = rings.get(key);
  if (!r) {
    r = { points: [], ts: [] };
    rings.set(key, r);
  }
  r.points.push(value);
  r.ts.push(ts);
  if (r.points.length > MAX_POINTS) {
    r.points.shift();
    r.ts.shift();
  }
}

export function series(key: string): number[] {
  return rings.get(key)?.points.slice() ?? [];
}

export function lastTs(key: string): number | null {
  const r = rings.get(key);
  return r && r.ts.length > 0 ? r.ts[r.ts.length - 1] : null;
}
