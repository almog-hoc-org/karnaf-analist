#!/usr/bin/env tsx
/**
 * Chart regression guard.
 *
 * WHY: recharts v3 silently drops every <Bar> <path> when its mount animation
 * runs under React 18 StrictMode — the axes, grid and legend still render, so a
 * chart looks "fine" while showing NO DATA. That shipped unnoticed on /national
 * (3 charts, zero bars) until a DOM measurement caught it (2026-07-31).
 *
 * This check is static (no browser needed) so it can run in the nightly:
 *   1. every <Bar>/<Line>/<Area> must set isAnimationActive={false}
 *   2. Tooltip formatters must use the tipFmt() shim, not the v2 signature
 *      `(value: number, name: string)` which no longer type-checks in v3.
 */
import fs from "fs";
import path from "path";

const COMPONENTS = path.resolve(process.cwd(), "components");
const SERIES_RE = /<(Bar|Line|Area)(?=[\s/>])/g;

let failures = 0;
let seriesChecked = 0;

for (const file of fs.readdirSync(COMPONENTS).filter((f) => f.endsWith(".tsx"))) {
  const src = fs.readFileSync(path.join(COMPONENTS, file), "utf8");
  if (!/from "recharts"/.test(src)) continue;

  let m: RegExpExecArray | null;
  SERIES_RE.lastIndex = 0;
  while ((m = SERIES_RE.exec(src)) !== null) {
    // scan to the end of the opening tag, respecting {…} nesting
    let j = m.index + m[0].length, depth = 0, end = -1;
    while (j < src.length) {
      const ch = src[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) { end = j; break; }
      j++;
    }
    if (end === -1) continue;
    seriesChecked++;
    if (!src.slice(m.index, end).includes("isAnimationActive")) {
      const line = src.slice(0, m.index).split("\n").length;
      console.error(`✗ ${file}:${line} — <${m[1]}> without isAnimationActive={false} (recharts v3 may render it empty)`);
      failures++;
    }
  }

  const legacy = src.match(/formatter=\{\((value|v):\s*number/g);
  if (legacy) {
    console.error(`✗ ${file} — ${legacy.length} Tooltip formatter(s) still using the v2 signature; wrap with tipFmt()`);
    failures += legacy.length;
  }
}

console.log(`chart guard: ${seriesChecked} series checked in components/`);
if (failures > 0) {
  console.error(`FAILED — ${failures} issue(s)`);
  process.exitCode = 1;
} else {
  console.log("PASS — every chart series renders without the v3 animation bug.");
}
