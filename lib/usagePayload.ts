import type {
  UsageSummary, UsagePageRow, UserUsageRow, VisitShape, VisitorShape, ExitRow, LandingRow,
  FunnelStage, DeadEndRow, CityDemandRow, CreditEconomy, CohortRow, EventSummaryRow,
  DepthRow, SectionRow, VitalRow, PathStep, EngagementRate, Stickiness, TimeToValue,
  Bucketed, LandingConversion,
} from "./events";
import type { DailyRow, PeriodComparison } from "./usageRollup";

/**
 * Everything the usage dashboard renders, in one response.
 *
 * Declared here rather than inside the panel because five tab components and
 * the API route all need the same shape, and a type that lives in the panel
 * would make every tab import its own parent — a cycle, and a rebuild of the
 * whole dashboard whenever one tab changes.
 *
 * One request rather than five: the tabs share most of their inputs (page
 * labels, comparisons, the funnel), and fetching per tab would re-run the same
 * queries each time the operator switched. The panel is opened rarely and read
 * for a while, which is exactly the shape that favours one payload.
 */
export interface UsagePayload {
  days: number;
  since: string | null;

  // ── who came
  summary: UsageSummary;
  shape: VisitShape;
  visitors: VisitorShape;
  engagement: EngagementRate;
  sticky: Stickiness;
  trend: DailyRow[];
  compare: PeriodComparison;
  rollup: { days: number; first: string | null; last: string | null };
  sources: Array<{ source: string; sessions: number }>;

  // ── conversion
  funnel: FunnelStage[];
  neverUnlocked: number;
  ttfv: TimeToValue;
  landingConversion: LandingConversion[];
  credits: CreditEconomy;

  // ── engagement
  cohorts: CohortRow[];
  sessionLengths: Bucketed[];
  adoption: Bucketed[];
  depth: DepthRow[];
  sections: SectionRow[];
  ctas: Array<{ cta: string; n: number; sessions: number }>;

  // ── content
  pages: UsagePageRow[];
  cities: Array<CityDemandRow & { quality: "thin" | "ok" | "partial" }>;
  searches: Array<{ term: string; n: number; misses: number }>;
  misses: Array<{ term: string; n: number }>;
  paths: PathStep[];
  landings: LandingRow[];

  // ── quality
  exits: ExitRow[];
  rage: DeadEndRow[];
  errors: Array<{ path: string; detail: string; n: number }>;
  vitals: VitalRow[];

  // ── people and raw
  users: UserUsageRow[];
  events: EventSummaryRow[];
}

/**
 * Percent change against the previous period, with the one case that matters
 * getting a real answer.
 *
 * A previous period of zero makes the arithmetic infinite, and "+∞%" renders
 * as a triumph when it almost always means "there was no data last month".
 * Null means "no comparison available" and the tile draws no arrow at all.
 *
 * IT LIVES HERE, NOT IN lib/usageRollup, and that is not tidiness. usageRollup
 * imports appDb, which imports better-sqlite3, which needs `fs` — so a client
 * component importing one function from it drags a native database driver into
 * the browser bundle and the build fails with "Can't resolve 'fs'". Type-only
 * imports are erased and stay safe; a runtime import is not. This file has no
 * runtime dependency on anything server-side, which is what makes it the right
 * home for a calculation both sides need.
 */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Shown wherever a measurement only started with the latest deploy. */
export const NOT_YET = "המדידה הזו התחילה עם הפריסה האחרונה — הנתונים מצטברים מהגולש הבא ואילך.";

/** Percentage of a total, guarding the zero denominator that renders as NaN. */
export const share = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
