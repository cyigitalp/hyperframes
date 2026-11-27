#!/usr/bin/env node
// Regenerates vendor/lemo-opuscar/styles.jsonl from an upstream lemo-opuscar checkout.
// Reads only style.json (MIT) and demo code (MIT); never copies Markdown (CC BY-NC).
// Usage: node scripts/lemo-opuscar-index.mjs <path-to-lemo-opuscar-checkout>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const src = process.argv[2];
if (!src || !existsSync(join(src, "styles"))) {
  console.error("usage: node scripts/lemo-opuscar-index.mjs <lemo-opuscar checkout>");
  process.exit(1);
}
const TAGS = [
  ["three", /from\s*["']three|THREE\./],
  ["three-post", /core\/three\/post/],
  ["crt-post", /core\/post\/crt|makeCRT/],
  ["webgl2", /webgl2/],
  ["canvas2d", /getContext\(\s*["']2d/],
  ["svg", /<svg|createElementNS/],
];
const rows = [];
for (const slug of readdirSync(join(src, "styles")).sort()) {
  const json = join(src, "styles", slug, "style.json");
  if (slug.startsWith("_") || !existsSync(json)) continue;
  const s = JSON.parse(readFileSync(json, "utf8"));
  const demo = join(src, "styles", slug, "demo");
  const code = existsSync(demo)
    ? readdirSync(demo)
        .filter((f) => /\.(m?js|html)$/.test(f))
        .map((f) => readFileSync(join(demo, f), "utf8"))
        .join("\n")
    : "";
  const tech = TAGS.filter(([, re]) => re.test(code)).map(([t]) => t);
  rows.push({ slug: s.slug, en: s.en, category: s.category_en, uses: s.uses, line: s.line, tech });
}
const out = new URL("../vendor/lemo-opuscar/styles.jsonl", import.meta.url);
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${rows.length} styles`);
