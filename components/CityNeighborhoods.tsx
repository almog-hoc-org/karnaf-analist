import type { NeighborhoodSnapshot } from "@/lib/neighborhoods";
import NumberCaption from "./NumberCaption";

function fmtNis(v: number | null): string {
  if (v === null) return "—";
  return `₪${Math.round(v).toLocaleString("he-IL")}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function PctChip({ value, label }: { value: number | null; label: string }) {
  if (value === null) {
    return (
      <div className="rounded-lg px-2.5 py-1.5 bg-slate-50 border border-slate-200">
        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{label}</div>
        <div className="text-sm font-bold text-slate-400 tabular-nums">—</div>
      </div>
    );
  }
  const positive = value >= 0;
  const cls = positive ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200";
  const text = positive ? "text-emerald-700" : "text-red-700";
  return (
    <div className={`rounded-lg px-2.5 py-1.5 border ${cls}`}>
      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${text}`}>
        {positive ? "▲" : "▼"} {fmtPct(value)}
      </div>
    </div>
  );
}

export default function CityNeighborhoods({ neighborhoods }: { neighborhoods: NeighborhoodSnapshot[] }) {
  if (!neighborhoods || neighborhoods.length === 0) {
    return (
      <section className="mb-10">
        <div className="section-header mb-4">
          <div className="section-header-icon bg-indigo-50 text-indigo-700">🏘️</div>
          <div>
            <h2>שכונות בעיר</h2>
            <p>אין נתוני שכונות זמינים לעיר זו במאגר</p>
          </div>
        </div>
        <div className="rounded-2xl bg-amber-50/50 border border-amber-200 p-5 text-center">
          <p className="text-sm text-slate-700">
            לעיר זו אין כרגע נתוני עסקאות פר שכונה ממאגר nadlan.gov.il.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            נתוני שכונות מגיעים מ-Govmap API של רשות המסים — נסרקים בכל רענון.
          </p>
        </div>
      </section>
    );
  }

  // Sort by deal volume — biggest neighborhoods first
  const sorted = [...neighborhoods].sort((a, b) => b.totalDeals - a.totalDeals);

  return (
    <section className="mb-10">
      <div className="section-header mb-4">
        <div className="section-header-icon bg-indigo-50 text-indigo-700">🏘️</div>
        <div className="flex-1">
          <h2>שכונות מובילות בעיר</h2>
          <p>נתוני עסקאות פר שכונה • מקור: nadlan.gov.il / Govmap • {neighborhoods.length} שכונות מוצגות</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {sorted.map((n, i) => {
          const accent = i === 0 ? "indigo" : i === 1 ? "cyan" : "amber";
          const cls = accent === "indigo"
            ? "from-indigo-500 to-indigo-600"
            : accent === "cyan"
            ? "from-cyan-500 to-cyan-600"
            : "from-amber-500 to-amber-600";
          return (
            <article key={n.name} className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden hover:shadow-lg transition-all">
              {/* Top accent stripe */}
              <div className={`h-1 bg-gradient-to-l ${cls}`} />

              <div className="p-4">
                {/* Header row */}
                <div className="flex items-start gap-2 mb-3">
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cls} text-white text-sm font-extrabold flex items-center justify-center shadow flex-shrink-0`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-slate-900 leading-tight truncate">{n.name}</h3>
                    {n.topStreet && (
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                        רחוב מוביל: <span className="font-semibold">{n.topStreet}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Volume mini-stats */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded-lg bg-slate-50/80 px-2.5 py-2 border border-slate-200">
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">סך עסקאות</div>
                    <div className="text-lg font-extrabold text-slate-900 tabular-nums leading-none mt-0.5">
                      {n.totalDeals.toLocaleString("he-IL")}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50/80 px-2.5 py-2 border border-slate-200">
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">לשנה (ממוצע)</div>
                    <div className="text-lg font-extrabold text-slate-900 tabular-nums leading-none mt-0.5">
                      {n.dealsPerYearAvg.toLocaleString("he-IL")}
                    </div>
                  </div>
                </div>

                {/* Current price */}
                <div className={`rounded-xl px-3 py-3 mb-3 bg-gradient-to-bl ${
                  accent === "indigo" ? "from-indigo-50 to-white border-indigo-200"
                  : accent === "cyan" ? "from-cyan-50 to-white border-cyan-200"
                  : "from-amber-50 to-white border-amber-200"
                } border`}>
                  <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wide mb-1">
                    מחיר ממוצע למ&quot;ר (נוכחי)
                  </div>
                  <div className={`text-2xl font-black tabular-nums ${
                    accent === "indigo" ? "text-indigo-700"
                    : accent === "cyan" ? "text-cyan-700"
                    : "text-amber-700"
                  }`}>
                    {fmtNis(n.currentPricePerSqm)}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    דירת 80 מ&quot;ר ממוצעת ב-{n.sampledStreets} רחובות • {n.sampleDeals} עסקאות
                  </p>
                  <NumberCaption
                    size="xxs"
                    source="nadlan.gov.il / Govmap"
                    sourceHref="https://www.nadlan.gov.il"
                    period="עסקאות 5 שנים אחרונות"
                    method="רשות המסים"
                  />
                </div>

                {/* Trend chips */}
                <div className="grid grid-cols-2 gap-2">
                  <PctChip value={n.change3y} label="vs 3 שנים" />
                  <PctChip value={n.change5y} label="vs 5 שנים" />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
        💡 הנתונים מבוססים על {neighborhoods.length} שכונות המובילות בנפח עסקאות. החישוב משתמש בדירת 80 מ&quot;ר כדי לנרמל בין רחובות (אם אין 80 מ&quot;ר — נופלים ל-60 או 100). מקור: rest.gov.il (רשות המסים) דרך Govmap API.
      </p>
    </section>
  );
}
