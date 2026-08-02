import fs from "fs";
import path from "path";

/**
 * CBS (למ"ס) national apartment-transactions series: NEW (חדשות) vs
 * SECOND-HAND (יד שנייה), from data/cbs_national_series.json.
 *
 * Grain note (honesty): CBS publishes the new/second-hand SPLIT annually and in
 * rolling-quarter releases — NOT monthly (the monthly CBS release covers new
 * dwellings only). So this series is annual with the latest rolling quarter
 * called out separately. Every number carries its CBS report id.
 */
export interface CbsSalesYear {
  year: number;
  total: number;
  neww: number | null;     // new dwellings (חדשות)
  existing: number | null; // second-hand (יד שנייה)
  totalOnly: number | null; // years CBS gave a total but no split (2021–22)
  newSharePct: number | null;
  yoyPct: number | null;
}
export interface CbsSalesData {
  years: CbsSalesYear[];
  latestQuarter: { period: string; total: number | null; newSharePct: number | null; yoyPct: number | null } | null;
  unsoldNew: { snapshot: string; units: number; monthsOfInventory: number | null } | null;
  insights: string[];
  updatedAt: string | null;
  reportIds: string[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function loadCbsSales(): CbsSalesData | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "cbs_national_series.json"), "utf8"));
  } catch {
    return null;
  }

  const annual = (raw.transactions_summary_by_year as Record<string, unknown>[] | undefined) ?? [];
  const years: CbsSalesYear[] = annual
    .map((r) => {
      const total = num(r.total_transactions) ?? 0;
      const neww = num(r.new_units);
      const existing = num(r.existing_units);
      const hasSplit = neww != null && existing != null;
      return {
        year: num(r.year) ?? 0,
        total,
        neww: hasSplit ? neww : null,
        existing: hasSplit ? existing : null,
        totalOnly: hasSplit ? null : total,
        newSharePct: hasSplit && total > 0 ? Math.round((neww! / total) * 1000) / 10 : num(r.new_share_pct),
        yoyPct: num(r.yoy_pct),
      };
    })
    .filter((y) => y.year > 0)
    .sort((a, b) => a.year - b.year);

  // latest rolling quarter with a real total
  const quarters = (raw.transactions_quarterly_recent as Record<string, unknown>[] | undefined) ?? [];
  const q = [...quarters].reverse().find((x) => num(x.total_transactions) != null) ?? null;
  const latestQuarter = q
    ? { period: String(q.period), total: num(q.total_transactions), newSharePct: num(q.new_share_pct), yoyPct: num(q.yoy_pct) }
    : null;

  const stockArr = (raw.stock_unsold_apartments_recent as Record<string, unknown>[] | undefined) ?? [];
  const stock = stockArr[stockArr.length - 1];
  const unsoldNew = stock
    ? { snapshot: String(stock.snapshot_date), units: num(stock.national_unsold_new) ?? 0, monthsOfInventory: num(stock.months_of_inventory) }
    : null;

  // ── auto-derived insights (all from the numbers above) ──────────────
  const insights: string[] = [];
  const withSplit = years.filter((y) => y.neww != null);
  const first = years[0], last = years[years.length - 1];
  if (first && last && first.total > 0) {
    const pct = Math.round((last.total / first.total - 1) * 100);
    insights.push(`היקף העסקאות הארצי ירד מ-${first.total.toLocaleString("he-IL")} (${first.year}) ל-${last.total.toLocaleString("he-IL")} (${last.year}) — ${Math.abs(pct)}% ${pct < 0 ? "פחות" : "יותר"}.`);
  }
  const lastSplit = withSplit[withSplit.length - 1];
  if (lastSplit && lastSplit.existing != null) {
    const shExisting = Math.round((lastSplit.existing / lastSplit.total) * 100);
    insights.push(`יד שנייה שולטת בשוק: ${shExisting}% מהעסקאות ב-${lastSplit.year} (${lastSplit.existing.toLocaleString("he-IL")} מתוך ${lastSplit.total.toLocaleString("he-IL")}).`);
  }
  if (withSplit.length >= 2) {
    const a = withSplit[withSplit.length - 2], b = lastSplit;
    if (a.newSharePct != null && b.newSharePct != null && latestQuarter?.newSharePct != null) {
      insights.push(`נתח הדירות החדשות מתכווץ: ${a.newSharePct}% (${a.year}) → ${b.newSharePct}% (${b.year}) → ${latestQuarter.newSharePct}% ברבעון האחרון.`);
    }
  }
  if (unsoldNew && unsoldNew.units > 0) {
    const moi = unsoldNew.monthsOfInventory ? ` (${unsoldNew.monthsOfInventory} חודשי היצע)` : "";
    insights.push(`מלאי הדירות החדשות הלא-מכורות בשיא: ${unsoldNew.units.toLocaleString("he-IL")} יח׳${moi} — עודף היצע בשוק החדש.`);
  }

  const reportIds = [
    ...new Set(
      [...annual, ...quarters]
        .map((r) => (r.report_id ?? r.source_report) as string | undefined)
        .filter((x): x is string => !!x)
    ),
  ].slice(0, 4);

  return { years, latestQuarter, unsoldNew, insights, updatedAt: (raw.lastUpdated as string) ?? null, reportIds };
}
