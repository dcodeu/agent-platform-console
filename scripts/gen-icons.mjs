#!/usr/bin/env node
// Bake PWA PNG icons from the SVG sources.
// Run once after editing icon.svg or icon-maskable.svg.
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, "..", "public");

const tasks = [
  { src: "icon.svg",          out: "icon-192.png",          size: 192 },
  { src: "icon.svg",          out: "icon-512.png",          size: 512 },
  { src: "icon.svg",          out: "apple-touch-icon.png",  size: 180 },
  { src: "icon-maskable.svg", out: "icon-maskable-192.png", size: 192 },
  { src: "icon-maskable.svg", out: "icon-maskable-512.png", size: 512 },
  { src: "icon.svg",          out: "favicon-32.png",        size: 32 },
];

for (const t of tasks) {
  const buf = readFileSync(resolve(pub, t.src));
  const png = await sharp(buf).resize(t.size, t.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  writeFileSync(resolve(pub, t.out), png);
  console.log(`  wrote ${t.out} (${t.size}×${t.size}, ${(png.length / 1024).toFixed(1)} KB)`);
}
console.log("done.");
