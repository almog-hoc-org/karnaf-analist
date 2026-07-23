import type { CityPriceChanges } from "@/lib/price-changes";
import type { CityGraphData, NadlanDeal } from "@/lib/nadlanTransactionSeries";
import MultiChartStudio from "./MultiChartStudio";
import PriceChangePanel from "./PriceChangePanel";

/**
 * One bordered section — everything from the COLLECTED nadlan transactions:
 *   1. The 3 price graphs (median · avg-all · avg-second-hand) with shared filters,
 *      period-comparison, and per-graph drill-down to the underlying deals (PriceGraphs).
 *   2. The city-wide median-price 3y/5y panel (a different metric — labelled).
 * Every block carries its own metric label + data source (house rules).
 */
export default function PriceChangeSection({
  priceChanges,
  graphData,
  deals,
  initialWindow,
  cityName,
}: {
  priceChanges: CityPriceChanges | null;
  graphData: CityGraphData | null;
  deals: NadlanDeal[];
  initialWindow: "3y" | "5y";
  cityName: string;
}) {
  return (
    <section className="mb-10 rounded-3xl border-2 border-indigo-200/70 bg-gradient-to-b from-indigo-50/40 to-white p-4 sm:p-6 shadow-sm">
      {/* Section header */}
      <div className="flex items-start gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white text-xl flex items-center justify-center flex-shrink-0 shadow">
          📈
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 leading-tight">
            מחירי עסקאות — 3 גרפים
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            חציון רשמי · ממוצע כל העסקאות · ממוצע יד-שנייה — מבוסס על העסקאות שנאספו, סוננו ונותחו • מקור: nadlan.gov.il (רשות המסים)
          </p>
        </div>
      </div>

      {/* 1. The three price graphs + shared controls + period compare + drill-down */}
      {graphData ? (
        <MultiChartStudio data={graphData} deals={deals} cityName={cityName} />
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 text-sm text-slate-500 mb-4">
          אין נתוני עסקאות מ-nadlan עבור {cityName} עדיין.
        </div>
      )}

      {/* 2. City-wide median price change (different metric — clearly labelled) */}
      <div className="mt-4 rounded-2xl bg-white/70 border border-slate-200 p-1">
        <div className="px-4 pt-3">
          <span className="inline-block text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
            מדד משלים — מחיר חציוני כולל לדירה (לא ₪/מ&quot;ר)
          </span>
        </div>
        <PriceChangePanel changes={priceChanges} initialWindow={initialWindow} cityName={cityName} />
      </div>
    </section>
  );
}
