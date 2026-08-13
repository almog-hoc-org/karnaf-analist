import InfoTip from "@/components/InfoTip";
import { MIN_N_HIDE, MIN_N_TRUST } from "@/lib/confidence";
import type { CityGraphData, StatPoint } from "@/lib/nadlanTransactionSeries";

/**
 * רובריקת מחירים לפי גודל דירה (operator spec 8/2026, city page item):
 * for 3 / 4 / 5+ room apartments — today's avg ₪/m² and avg deal price vs the
 * start of the chart's default range, split by second-hand / new / all.
 *
 * Server component, zero interactivity: the numbers people actually quote to
 * each other ("כמה עולה 4 חדרים בחדרה?") pulled out of the chart into plain
 * text. Same stats table, same n≥10 floor as every chart cell; endpoints with
 * n<30 carry the thin-sample mark rather than false confidence.
 */

type ScopeKey = "secondhand" | "new" | "all";
const SCOPE_LABEL: Record<ScopeKey, string> = { secondhand: "יד שנייה", new: "חדשות", all: "כללי" };
const BUCKETS = [
  { key: "3" as const, label: "3 חדרים" },
  { key: "4" as const, label: "4 חדרים" },
  { key: "5" as const, label: "5+ חדרים" },
];

interface CellChange {
  fromYear: number;
  toYear: number;
  sqmFrom: number | null;
  sqmTo: number | null;
  priceFrom: number | null;
  priceTo: number | null;
  thin: boolean;
}

function usable(p: StatPoint | undefined): p is StatPoint {
  return !!p && p.n >= MIN_N_HIDE;
}

/** endpoints: last full year vs the earliest usable year ≥ rangeStart */
function change(points: StatPoint[], rangeStart: number, endYear: number): CellChange | null {
  const to = points.find((p) => p.year === endYear);
  if (!usable(to)) return null;
  const from = points
    .filter((p) => p.year >= rangeStart && p.year < endYear)
    .sort((a, b) => a.year - b.year)
    .find(usable);
  if (!from) return null;
  return {
    fromYear: from.year,
    toYear: to.year,
    sqmFrom: from.avgSqm,
    sqmTo: to.avgSqm,
    priceFrom: from.avgPrice,
    priceTo: to.avgPrice,
    thin: from.n < MIN_N_TRUST || to.n < MIN_N_TRUST,
  };
}

const nis = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
const nisM = (v: number | null) => (v == null ? "—" : `₪${(v / 1_000_000).toFixed(2)}M`);
const pct = (from: number | null, to: number | null) => {
  if (!from || !to || from <= 0) return null;
  return (to / from - 1) * 100;
};

function Delta({ from, to }: { from: number | null; to: number | null }) {
  const p = pct(from, to);
  if (p == null) return null;
  return (
    <span dir="ltr" className={`text-2xs font-bold tabular-nums ${p >= 0 ? "text-emerald-700" : "text-red-600"}`}>
      {p >= 0 ? "+" : ""}{p.toFixed(1)}%
    </span>
  );
}

export default function RoomPriceSummary({ data, classificationRate = null }: {
  data: CityGraphData;
  classificationRate?: number | null;
}) {
  const endYear = data.lastFullYear;
  if (endYear == null) return null;
  const rangeStart = endYear - 10;

  // classification gate (QA spec): under 20% classified, the sh/new columns
  // would describe a sliver of the market — show "כללי" only.
  const lowClass = classificationRate != null && classificationRate < 0.2;
  const scopes: ScopeKey[] = lowClass ? ["all"] : ["secondhand", "new", "all"];

  const rows = BUCKETS.map((b) => ({
    bucket: b,
    cells: scopes.map((scope) => ({
      scope,
      c: change(data.nadlan[scope]?.[b.key] ?? [], rangeStart, endYear),
    })),
  })).filter((r) => r.cells.some((c) => c.c !== null));

  if (rows.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="section-header">
        <div className="section-header-icon">🚪</div>
        <div>
          <h2 className="flex items-center gap-2 flex-wrap">
            מחירים לפי גודל דירה
            <InfoTip text={`ממוצע ₪/מ"ר ומחיר עסקה ממוצע ב-${endYear} מול תחילת טווח הגרף, לכל גודל דירה. אותם נתונים ואותם ספי מדגם כמו בגרפים (10+ עסקאות לשנה; ⚠ = פחות מ-30).`} />
          </h2>
          <p>{endYear} מול תחילת הטווח · מאגר העסקאות העצמאי</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {rows.map(({ bucket, cells }) => (
          <div key={bucket.key} className="glass-card p-4">
            <div className="mb-2.5 text-sm font-black text-slate-900">{bucket.label}</div>
            <div className="space-y-2.5">
              {cells.map(({ scope, c }) => {
                if (!c) return (
                  <div key={scope} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-400">{SCOPE_LABEL[scope]}</span>
                    <span className="text-slate-300">אין מדגם מספק</span>
                  </div>
                );
                return (
                  <div key={scope} className="rounded-lg bg-slate-50/70 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-2xs font-bold text-slate-600">{SCOPE_LABEL[scope]}{c.thin ? " ⚠" : ""}</span>
                      <span className="text-2xs text-slate-400 tabular-nums">{c.fromYear}→{c.toYear}</span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="text-2xs text-slate-500">₪/מ״ר</span>
                      <span className="text-xs tabular-nums text-slate-700">{nis(c.sqmFrom)} ← <b className="text-sm text-slate-900">{nis(c.sqmTo)}</b></span>
                      <Delta from={c.sqmFrom} to={c.sqmTo} />
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-2">
                      <span className="text-2xs text-slate-500">מחיר עסקה</span>
                      <span className="text-xs tabular-nums text-slate-700">{nisM(c.priceFrom)} ← <b className="text-sm text-slate-900">{nisM(c.priceTo)}</b></span>
                      <Delta from={c.priceFrom} to={c.priceTo} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-2xs text-slate-400">
        ממוצעים על עסקאות עם 10+ בשנה · ⚠ = אחד הקצוות עם פחות מ-30 עסקאות — מדגם דל
        {lowClass ? " · פילוח יד-2/חדשות מוסתר בעיר זו (שיעור סיווג נמוך)" : ""}
      </p>
    </section>
  );
}
