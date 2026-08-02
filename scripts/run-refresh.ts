#!/usr/bin/env tsx
/**
 * CLI driver for the refresh engine — same generator the button uses.
 * Usage: npx tsx scripts/run-refresh.ts [probeBudget]
 */
import { refreshDataStream } from "../lib/data-refresh";

async function main() {
  const probeBudget = Number(process.argv[2]) || undefined;
  for await (const e of refreshDataStream({ probeBudget })) {
    console.log(`[${e.type}] ${e.message}`);
  }
}
main().catch((e) => { console.error("FATAL", e); process.exitCode = 1; });
