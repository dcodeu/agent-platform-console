import assert from "node:assert/strict";
import test from "node:test";

import {
  KUMA_TOTAL_PROMQL,
  KUMA_UP_PROMQL,
  formatKumaMonitorSub,
  formatKumaMonitorValue,
  kumaDownCount,
} from "./server-kuma-counts.ts";

test("Kuma monitor PromQL counts real monitor_status series instead of upstream buckets", () => {
  assert.equal(KUMA_TOTAL_PROMQL, "count(monitor_status)");
  assert.equal(KUMA_UP_PROMQL, "count(monitor_status == 1)");
});

test("formatKumaMonitorValue renders X of Y from Prometheus monitor totals", () => {
  assert.equal(formatKumaMonitorValue(60, 62), "60 of 62");
  assert.equal(formatKumaMonitorValue(null, 62), "—");
  assert.equal(formatKumaMonitorValue(60, null), "—");
});

test("kumaDownCount clamps negative exporter skew and formats the subtitle", () => {
  assert.equal(kumaDownCount(62, 60), 2);
  assert.equal(kumaDownCount(62, 63), 0);
  assert.equal(kumaDownCount(null, 60), null);
  assert.equal(formatKumaMonitorSub(2), "2 monitors down");
  assert.equal(formatKumaMonitorSub(0), "all monitors up");
  assert.equal(formatKumaMonitorSub(null), "Uptime checks reporting in");
});
