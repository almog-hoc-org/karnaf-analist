/**
 * The cleaning + aggregation pipeline: ONE definition of the order, used by
 * both the admin "apply changes" button and the scheduled run.
 *
 * WHY THIS FILE EXISTS
 * The correct order lived only as prose — in README.md and in each script's
 * header comment ("the order is critical; each step assumes the previous
 * finished"). Nothing executed it. The admin route hard-coded its own shorter
 * list, and the two shell refresh scripts ran no cleaning steps at all. So the
 * documented pipeline and the pipeline that actually ran had drifted apart,
 * silently, in the direction that produces wrong numbers.
 *
 * Three stages were missing from the admin route, and the consequences were not
 * cosmetic:
 *
 *   - `classify-sale-channel` writes `class_source`, and
 *     aggregate-nadlan-transactions.ts:106 gates the entire "all" price scope on
 *     `class_source IS NOT NULL`. Without it, every newly collected transaction
 *     is silently absent from the site's main price series. Collected, stored,
 *     and never shown.
 *   - `reclassify-rooms-by-area` writes `rooms_effective`, and
 *     flag-outlier-deals.ts:70 filters on `rooms_effective > 0`. A row with NULL
 *     there is not merely unflagged — it drops out of the scan entirely and
 *     never contributes to a cohort median. All ten room-area rules in the
 *     dashboard were inert.
 *   - `merge-cross-channel` is step one in the documented order and was absent.
 *
 * ORDER CORRECTION vs README
 * README places `classify-sale-channel` AFTER `flag-luxury-deals`. That is
 * wrong: classify writes `is_secondhand`, and flag-luxury-deals.ts:84 reads
 * `is_secondhand` to build its cohorts. Under the documented order the luxury
 * cohorts are computed against the PREVIOUS run's classification. Classify runs
 * before luxury here.
 */

export interface PipelineStage {
  /** Stable id — used by --from and by the run log. Never rename casually. */
  id: string;
  /** Path relative to the repo root. */
  script: string;
  /** Extra CLI arguments passed to the script. */
  args?: string[];
  /** Hebrew label for the admin UI. */
  label: string;
  /** Why this stage sits exactly here. Read this before reordering anything. */
  why: string;
  /** A verification gate rather than a mutation: failure means "do not publish". */
  gate?: boolean;
  /** Pure reporting — writes audit artifacts, never the site's data. Skipped by the admin fast path. */
  report?: boolean;
  /** Per-stage timeout. Aggregation over ~1M rows is the slow one. */
  timeoutMs: number;
}

const MINUTE = 60_000;

export const PIPELINE: PipelineStage[] = [
  {
    id: "indexes",
    script: "scripts/ensure-indexes.ts",
    label: "אינדקסים לקריאה",
    why: "Prisma migrations are never applied to the live DB, so read-path indexes have to be created by something that runs against it. Idempotent and first: the cleaning stages that follow scan the same table, and an index that exists helps them too.",
    timeoutMs: 10 * MINUTE,
  },
  {
    id: "merge",
    script: "scripts/merge-cross-channel.ts",
    label: "מיזוג ערוצים",
    why: "Must be first: it reconciles the same deal arriving from two sources and enriches addresses. Everything downstream counts rows, so duplicates across channels have to collapse before anything is measured.",
    timeoutMs: 15 * MINUTE,
  },
  {
    id: "rooms",
    script: "scripts/reclassify-rooms-by-area.ts",
    label: "סיווג חדרים לפי שטח",
    why: "Writes rooms_effective / room_bucket. flag-outlier, flag-luxury and the aggregation all key their cohorts on these, and flag-outlier DROPS rows where rooms_effective is null.",
    timeoutMs: 15 * MINUTE,
  },
  {
    id: "secondhand",
    script: "scripts/recompute-secondhand.ts",
    label: "חישוב יד-שנייה מחדש",
    why: "Re-derives is_secondhand from the secondhand_min_age rule. The collectors burn a hardcoded 4 at insert time, so without this the dashboard rule and the stored data disagree. Runs before classify, which only fills in rows that have no build year.",
    timeoutMs: 10 * MINUTE,
  },
  {
    id: "classify",
    script: "scripts/classify-sale-channel.ts",
    label: "סיווג ערוץ מכירה",
    why: "Writes class_source, which the aggregation requires for the 'all' scope, and fills is_secondhand for rows with no build year. MUST precede flag-luxury, which reads is_secondhand — this is where the README order is wrong.",
    timeoutMs: 15 * MINUTE,
  },
  {
    id: "dupes",
    script: "scripts/flag-duplicate-deals.ts",
    label: "כפילויות דיווח",
    why: "Duplicates leave before any median is computed, so anomaly and luxury cohorts are not measured against double-counted prices.",
    timeoutMs: 20 * MINUTE,
  },
  {
    id: "outliers",
    script: "scripts/flag-outlier-deals.ts",
    label: "אנומליות מחיר",
    why: "Needs rooms_effective (from rooms) and a duplicate-free population (from dupes) to build honest cohort medians.",
    timeoutMs: 20 * MINUTE,
  },
  {
    id: "luxury",
    script: "scripts/flag-luxury-deals.ts",
    label: "עסקאות יוקרה",
    why: "Reads is_secondhand and rooms_effective for its cohorts, so it runs after both are settled.",
    timeoutMs: 20 * MINUTE,
  },
  {
    id: "aggregate",
    script: "scripts/aggregate-nadlan-transactions.ts",
    label: "אגרגציה",
    why: "Last mutation: reads every flag written above and materialises nadlan_year_room_stats, the table every price graph reads.",
    timeoutMs: 30 * MINUTE,
  },
  {
    id: "retention",
    script: "scripts/prune-retention.ts",
    label: "אכיפת תקופות שמירה",
    why: "Deletes events, feedback and expired sessions past the retention periods PUBLISHED in the privacy notice. Both this and the notice read the same constants from lib/legal.ts, so a stated policy cannot drift from what the database actually holds — which is the difference between a commitment and a claim.",
    timeoutMs: 10 * MINUTE,
  },
  {
    id: "verify-cleaning",
    script: "scripts/verify-cleaning-rules.ts",
    label: "אימות כללי ניקוי",
    why: "Re-derives the duplicate and luxury rules from scratch and reconciles total = active + excluded. Independent of the code that applied them, which is the point.",
    gate: true,
    timeoutMs: 15 * MINUTE,
  },
  {
    id: "verify-anomalies",
    script: "scripts/verify-anomalies.ts",
    label: "אימות אנומליות",
    why: "Re-derives cohort medians and asserts no active deal still deviates beyond the configured threshold.",
    gate: true,
    timeoutMs: 15 * MINUTE,
  },
  {
    id: "audit-reliability",
    script: "scripts/audit-data-reliability.ts",
    label: "בקרת אמינות נתונים",
    why: "Refreshes data-reliability.json — the file the admin reliability panel reads. The panel promised this ran nightly while nothing actually ran it, so the flags on screen were frozen at whenever someone last ran the script by hand. After the gates: the report should describe data that passed its checks.",
    report: true,
    timeoutMs: 15 * MINUTE,
  },
  {
    id: "coverage",
    script: "scripts/coverage-report.ts",
    args: ["--save"],
    label: "דוח כיסוי",
    why: "Snapshots city×year coverage so the next quarterly collection pulse can answer 'did it improve anything?'. Between pulses the data barely moves, so the nightly snapshot converges on the pre-pulse baseline — exactly the comparison the post-pulse run needs.",
    report: true,
    timeoutMs: 10 * MINUTE,
  },
  {
    id: "data-contract",
    script: "scripts/verify-data-contract.ts",
    label: "חוזה raw↔stats",
    why: "Checks the NEGATIVE space every other audit misses: usable transactions with no stat row, active cities with no stats at all, year-range drift between raw and stats, and alias names the merge stage failed to fold. This is the check that would have caught the silent 2016 floor — 20k usable deals with no chart point — the day it happened instead of at a QA deep-dive months later.",
    report: true,
    timeoutMs: 10 * MINUTE,
  },
];

export const STAGE_IDS = PIPELINE.map((s) => s.id);

/**
 * The stages to run, optionally resuming from one.
 * Throws on an unknown id rather than silently running everything.
 */
export function stagesFrom(fromId?: string): PipelineStage[] {
  if (!fromId) return PIPELINE;
  const i = PIPELINE.findIndex((s) => s.id === fromId);
  if (i < 0) throw new Error(`unknown stage "${fromId}". known: ${STAGE_IDS.join(", ")}`);
  return PIPELINE.slice(i);
}

/** Mutation stages only — used when a caller wants to skip the verification gates. */
export function mutationStages(): PipelineStage[] {
  return PIPELINE.filter((s) => !s.gate && !s.report);
}
