#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.URL || "http://127.0.0.1:8080/";
const OUT = "/tmp/console-shots";
mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: "iphone-se",  width: 375,  height: 667,  isMobile: true,  scale: 2 },
  { name: "iphone-15",  width: 393,  height: 852,  isMobile: true,  scale: 3 },
  { name: "ipad",       width: 768,  height: 1024, isMobile: true,  scale: 2 },
  { name: "desktop",    width: 1280, height: 800,  isMobile: false, scale: 1 },
];

const browser = await chromium.launch({ headless: true });

for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.scale,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    userAgent: vp.isMobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const failedReqs = [];
  page.on("requestfailed", (req) => failedReqs.push(`${req.failure()?.errorText ?? "?"} ${req.url()}`));

  console.log(`\n=== ${vp.name} (${vp.width}×${vp.height}) ===`);
  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 15000 });
  } catch (e) {
    console.log("  navigate timed out, continuing");
  }
  await page.waitForTimeout(900); // let fonts settle

  // Get computed body font, theme, key text
  const diag = await page.evaluate(() => {
    const body = document.body;
    const cs = getComputedStyle(body);
    const appbar = document.querySelector(".appbar");
    const acs = appbar && getComputedStyle(appbar);
    const tab = document.querySelector(".tab-panel.tab-active");
    const tabRect = tab?.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll(".card")).slice(0, 3).map((el) => {
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      return { w: Math.round(r.width), h: Math.round(r.height), bg: c.backgroundColor, border: c.borderColor, radius: c.borderRadius };
    });
    return {
      bodyFont: cs.fontFamily,
      bodyBg: cs.backgroundColor,
      bodyColor: cs.color,
      bodyFontSize: cs.fontSize,
      htmlScrollWidth: document.documentElement.scrollWidth,
      htmlClientWidth: document.documentElement.clientWidth,
      hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      appbarBg: acs?.backgroundColor,
      activeTab: tab?.dataset?.tabPanel,
      activeTabHeight: tabRect ? Math.round(tabRect.height) : null,
      cards,
      bottomNavVisible: !!document.querySelector(".bottom-nav"),
    };
  });

  await page.screenshot({ path: `${OUT}/${vp.name}.png`, fullPage: true });
  console.log("  diag:", JSON.stringify(diag, null, 2));
  if (consoleErrors.length) console.log("  console errors:", consoleErrors);
  if (failedReqs.length) console.log("  failed requests:", failedReqs);
  await ctx.close();
}

await browser.close();
console.log("\nshots saved to", OUT);
