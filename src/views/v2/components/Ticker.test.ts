import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const tickerSource = readFileSync("src/views/v2/components/Ticker.tsx", "utf8");

test("event ticker does not render the legacy MTD budget placeholder chip", () => {
  assert.doesNotMatch(tickerSource, /MTD\s*000%\s*budget/i);
  assert.doesNotMatch(tickerSource, /000%/);
  assert.doesNotMatch(tickerSource, /y2-ticker-chip/);
});

test("event ticker ignores cost ticks so absent budget data cannot fall back to zero", () => {
  assert.doesNotMatch(tickerSource, /addEventListener\(\s*["']cost\.tick["']/);
});

test("event ticker source avoids raw SSE implementation labels", () => {
  assert.doesNotMatch(tickerSource, />\s*LIVE\s*·\s*SSE\s*</);
  assert.match(tickerSource, /LIVE\s*·\s*live stream/);
});
