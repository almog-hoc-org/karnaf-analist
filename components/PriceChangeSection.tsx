import type { CityPriceChanges } from "@/lib/price-changes";
import type { CityGraphData, DealCountCube, NadlanDeal } from "@/lib/nadlanTransactionSeries";
import MultiChartStudio from "./MultiChartStudio";
import PriceChangePanel from "./PriceChangePanel";
import Icon from "@/components/Icon";
import InfoTip from "@/components/InfoTip";

/**
 * One bordered section — everything from the COLLECTED nadlan transactions:
 *   1. The 3 price graphs (median · avg-all · avg-second-hand) with shared filters,
 *      period-comparison, and per-graph drill-down to the underlying deals (MultiChartStudio).
 *   2. The city-wide median-price 3y/5y panel (a different metric — labelled).
 * Every block carries its own metric label + data source (house rules).
 */
export default function PriceChangeSection({
  priceChanges,
  graphData,
  deals,
  dealCounts,
  cleaning,
  initialWindow,
  cityName,
  secondhandMinAge = 4,
  modernMinYear = 2005,
  classificationRate = null,
  subsidizedYears = [],
  minSample,
}: {
  priceChanges: CityPriceChanges | null;
  graphData: CityGraphData | null;
  deals: NadlanDeal[];
  dealCounts?: DealCountCube;
  cleaning?: { dupes: number; luxury: number };
  initialWindow: "3y" | "5y";
  cityName: string;
  secondhandMinAge?: number;
  modernMinYear?: number;
  classificationRate?: number | null;
  subsidizedYears?: Array<{ year: number; share: number; medLow: number | null; medSecondhand: number | null }>;
  /** live min_deals_per_year rule, so the chart and the price tables share one floor */
  minSample?: number;
}) {
  return (
    <section className="mb-10 rounded-3xl border-2 border-indigo-200/70 bg-gradient-to-b from-indigo-50/40 to-white p-4 sm:p-6 shadow-sm">
      {/* Section header */}
      <div className="flex items-start gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white text-xl flex items-center justify-center flex-shrink-0 shadow">
          <Icon name="trend-up" size="1em" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="flex items-center gap-1.5 text-xl sm:text-2xl font-extrabold text-slate-900 leading-tight">
            מגמות מחירים
            {/* The series list, the source and the second-hand rule used to be
                a 110-character subtitle — three lines on a phone. House rule
                says every metric block states its source; it does not say the
                source has to cost three lines. */}
            <InfoTip text={`שלוש סדרות: חציון רשמי · ממוצע כל העסקאות · ממוצע יד-שנייה. מקור: nadlan.gov.il (רשות המסים). יד-שנייה = ${secondhandMinAge}+ שנים משנת הבנייה.`} label="הסבר: מגמות מחירים" />
          </h2>
          <p className="mt-1 truncate text-xs text-slate-500">
            מבוסס על העסקאות שנאספו, סוננו ונותחו
          </p>
        </div>
      </div>

      {/* 1. The three price graphs + shared controls + period compare + drill-down */}
      {graphData ? (
        <MultiChartStudio data={graphData} deals={deals} dealCounts={dealCounts} cleaning={cleaning} cityName={cityName} modernMinYear={modernMinYear} classificationRate={classificationRate}
          subsidizedYears={subsidizedYears} minSample={minSample} />
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 text-sm text-slate-500 mb-4">
          אין נתוני עסקאות מ-nadlan עבור {cityName} עדיין.
        </div>
      )}

      {/* 2. City-wide median price change — ONE framed row (operator, 8/2026):
          the last line of the rubric, right under the notes below the graph.
          The panel carries its own frame, label and ⓘ, so the old badge
          wrapper around it is gone. */}
      <PriceChangePanel changes={priceChanges} initialWindow={initialWindow} cityName={cityName} />
    </section>
  );
}
