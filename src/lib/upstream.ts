export interface UpstreamHealth {
  name: string;
  ok: boolean;
  latencyMs: number;
  lastOkAt?: number;
  consecutiveFailures: number;
  error?: string;
}

const state = new Map<string, UpstreamHealth>();

export function recordProbe(
  name: string,
  result: { ok: boolean; latencyMs: number; error?: string },
): UpstreamHealth {
  const prev = state.get(name);
  const next: UpstreamHealth = {
    name,
    ok: result.ok,
    latencyMs: result.latencyMs,
    lastOkAt: result.ok ? Date.now() : prev?.lastOkAt,
    consecutiveFailures: result.ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
    error: result.error,
  };
  state.set(name, next);
  return next;
}

export function getUpstreamHealth(): UpstreamHealth[] {
  return [...state.values()];
}
