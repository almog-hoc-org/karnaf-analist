import type { CityFact, CityTimeSeries } from "@/lib/scatteredFacts";

interface Props {
  facts: CityFact[];
  timeSeries: CityTimeSeries[];
}

const categoryConfig: Record<
  CityFact["category"],
  { label: string; icon: string; accent: string; bg: string }
> = {
  construction: {
    label: "בנייה",
    icon: "🏗️",
    accent: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
  },
  price_index: {
    label: "מחירים",
    icon: "💰",
    accent: "text-cyan-700",
    bg: "bg-cyan-50 border-cyan-200",
  },
  population: {
    label: "אוכלוסייה",
    icon: "👥",
    accent: "text-purple-700",
    bg: "bg-purple-50 border-purple-200",
  },
  other: {
    label: "אחר",
    icon: "📋",
    accent: "text-slate-700",
    bg: "bg-slate-50 border-slate-200",
  },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("he-IL", { year: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

function FactCard({ fact }: { fact: CityFact }) {
  const cat = categoryConfig[fact.category] ?? categoryConfig.other;
  return (
    <div className="glass-card p-4 group">
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 ${cat.bg}`}
        >
          {cat.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${cat.accent}`}>
              {cat.label}
            </span>
            <span className="text-[10px] text-slate-400">·</span>
            <span className="text-[10px] text-slate-500">{formatDate(fact.published)}</span>
            {fact.confidence === "medium" && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                אומדן
              </span>
            )}
          </div>
          <p className="text-sm text-slate-800 leading-relaxed">{fact.fact}</p>
          <a
            href={fact.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-[11px] text-slate-500 hover:text-cyan-700 transition-colors"
          >
            <span>{fact.source_name}</span>
            <span>↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function TimeSeriesCard({ series }: { series: CityTimeSeries }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">{series.metric}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">יחידה: {series.unit}</p>
        </div>
        <a
          href={series.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-slate-500 hover:text-cyan-700 transition-colors flex items-center gap-1"
        >
          <span>{series.source_name}</span>
          <span>↗</span>
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums" dir="rtl">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 px-3 text-right text-xs text-slate-500 font-semibold">תקופה</th>
              <th className="py-2 px-3 text-left text-xs text-slate-500 font-semibold">{series.unit}</th>
              <th className="py-2 px-3 text-left text-xs text-slate-400 font-medium">שינוי</th>
            </tr>
          </thead>
          <tbody>
            {series.data.map((row, idx) => {
              const prev = idx > 0 ? series.data[idx - 1] : null;
              const change = prev && prev.value !== 0 ? ((row.value - prev.value) / prev.value) * 100 : null;
              return (
                <tr key={row.period} className="border-b border-slate-100">
                  <td className="py-2 px-3 text-right font-medium text-slate-800">{row.period}</td>
                  <td className="py-2 px-3 text-left font-bold text-slate-900">
                    {row.value.toLocaleString("he-IL")}
                  </td>
                  <td className="py-2 px-3 text-left text-xs">
                    {change !== null ? (
                      <span className={change >= 0 ? "text-emerald-600" : "text-rose-600"}>
                        {change >= 0 ? "+" : ""}
                        {change.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ScatteredFactsSection({ facts, timeSeries }: Props) {
  if (facts.length === 0 && timeSeries.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="section-header mb-5">
        <div className="section-header-icon bg-purple-100 text-purple-700">📰</div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">עדכונים נוספים מדוחות רשמיים</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            פרטים מפוזרים על העיר מהודעות לעיתונות, דוחות סקירת שוק וכלכלן ראשי
          </p>
        </div>
      </div>

      {facts.length > 0 && (
        <div className="space-y-3 mb-5">
          {facts.map((fact, idx) => (
            <FactCard key={`${fact.source_url}-${idx}`} fact={fact} />
          ))}
        </div>
      )}

      {timeSeries.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {timeSeries.map((series, idx) => (
            <TimeSeriesCard key={`${series.metric}-${idx}`} series={series} />
          ))}
        </div>
      )}
    </section>
  );
}
