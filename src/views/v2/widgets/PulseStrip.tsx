// PulseStrip — thin always-on strip of 4 system-wide live metrics, mounted
// above every tab. No card chrome: it's an inline rail of pill-shaped
// number+label pairs separated by thin dividers, tuned to feel like the live
// vitals bar on a trading terminal.
//
// Sources:
//   tokens/min       — last 1-min sum over ai_invocations (via /api/metrics/pg)
//   invocations/min  — same, row count
//   approvals        — useApprovalsCount() (live across SSE)
//   alerts           — heavy.alerts.length (refreshes on heavy poll)
//
// Mobile (<768px): hidden — the bottom-nav already surfaces the same signals.

import { useMemo } from "react";

import { useHeavy } from "../data/queries.ts";
import { useApprovalsCount } from "../tabs/use-approvals-count.ts";
import { usePgQuery } from "./useNativeData.ts";
import { formatCount, formatTokens } from "../data/format.ts";
import "./PulseStrip.css";

// Single query → two metrics. We use 1-min window aligned to ts to keep the
// rate intuitive ("right now per minute") and refresh every 30s so we don't
// thunder the pg pool.
const PULSE_SQL = `
  SELECT
    coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)::bigint AS tokens_min,
    count(*)::int AS invocations_min
  FROM ai_invocations
  WHERE ts > now() - interval '1 minute'
`.trim();

interface PulseRow {
  tokens_min: number;
  invocations_min: number;
}

export function PulseStrip() {
  const heavy = useHeavy();
  const approvalsCount = useApprovalsCount();
  const pulse = usePgQuery(PULSE_SQL, { refetchMs: 30_000 });

  const row = useMemo<PulseRow>(() => {
    const d = pulse.data;
    if (!d || d.rows.length === 0) return { tokens_min: 0, invocations_min: 0 };
    const ti = d.columns.indexOf("tokens_min");
    const ii = d.columns.indexOf("invocations_min");
    const r = d.rows[0];
    return {
      tokens_min: ti >= 0 ? Number(r[ti] ?? 0) : 0,
      invocations_min: ii >= 0 ? Number(r[ii] ?? 0) : 0,
    };
  }, [pulse.data]);

  const alertCount = heavy.data?.alerts?.length ?? 0;

  return (
    <aside className="y2-pulse-strip" aria-label="Live system pulse">
      <PulseItem
        label="tokens/min"
        value={formatTokens(row.tokens_min)}
        loading={pulse.isPending}
      />
      <PulseItem
        label="invocations/min"
        value={formatCount(row.invocations_min)}
        loading={pulse.isPending}
      />
      <PulseItem
        label="pending approvals"
        value={formatCount(approvalsCount)}
        emphasis={approvalsCount > 0 ? "attn" : undefined}
      />
      <PulseItem
        label="alerts"
        value={formatCount(alertCount)}
        emphasis={alertCount > 0 ? "alert" : undefined}
        loading={heavy.isPending}
      />
    </aside>
  );
}

interface PulseItemProps {
  label: string;
  value: string;
  loading?: boolean;
  emphasis?: "attn" | "alert";
}

function PulseItem({ label, value, loading, emphasis }: PulseItemProps) {
  const valClass =
    emphasis === "attn"
      ? "y2-pulse-val y2-pulse-val--attn"
      : emphasis === "alert"
        ? "y2-pulse-val y2-pulse-val--alert"
        : "y2-pulse-val";
  return (
    <div className="y2-pulse-item">
      <span className="y2-pulse-label">{label}</span>
      <span className={valClass} aria-busy={loading ? "true" : undefined}>
        {loading ? "—" : value}
      </span>
    </div>
  );
}
