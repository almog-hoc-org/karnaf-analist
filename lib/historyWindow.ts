/**
 * The historical floor of the whole data pipeline — ONE constant, everywhere.
 *
 * WHY THIS EXISTS
 * Every cleaning stage and the aggregation used to carry its own private
 * `YEARS_BACK = 10` / `now - 10` window. The raw table holds transactions back
 * to 1998, but nothing older than a rolling decade was ever merged, classified,
 * flagged or aggregated — so the stats table (and every chart) silently
 * started at 2016 while the product claimed a full independent archive. A QA
 * deep-dive (2026-08-12) measured the cost: 20,447 usable transactions with no
 * chart point, 19,932 stat rows where a full rebuild produces ~41,000.
 *
 * The DISPLAY default stays a decade — recent years are what most decisions
 * need — but display windows are a product choice made in components, not a
 * ceiling baked into the pipeline. The pipeline's job is to make the full
 * archive usable; hiding history is the UI's call.
 *
 * The rolling-decade helper stays for the callers that genuinely want a
 * quality window (coverage/reliability audits, ranking eligibility): those
 * measure "is the product-critical decade complete", which is a different
 * question from "how far back does the archive go".
 */
import { getRuleNum } from "./systemRules";

/** Earliest deal_year the pipeline processes. Overridable via admin rule. */
export function historyFromYear(): number {
  try {
    return getRuleNum("history_from_year", 1998);
  } catch {
    // rules table absent (fresh machine / standalone script run)
    return 1998;
  }
}

/** The rolling product decade — for QUALITY windows only, not pipeline gates. */
export function productDecadeFrom(): number {
  return new Date().getFullYear() - 10;
}
