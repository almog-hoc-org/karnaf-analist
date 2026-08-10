"use client";

import { motion } from "framer-motion";

interface YearData {
  year: number;
  populationGrowthPct: number | null;
  requiredHouseholds: number | null;
  householdsGrowth: number | null;
  buildingPermits: number | null;
  constructionStarts: number | null;
}

interface CorrelationTableProps {
  data: YearData[];
  cityName: string;
  avgHouseholdSize: number | null;
}

function fmt(val: number | null): string {
  if (val === null || val === undefined) return "—";
  return Math.round(val).toLocaleString("he-IL");
}

function fmtPct(val: number | null): string {
  if (val === null || val === undefined) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
}

function getGapColor(permits: number | null, required: number | null): string {
  if (!permits || !required || required === 0) return "text-slate-400";
  const ratio = permits / required;
  if (ratio >= 1.1) return "text-emerald-700";
  if (ratio >= 0.8) return "text-slate-600";
  return "text-red-600";
}

export default function CorrelationTable({
  data,
  avgHouseholdSize,
}: CorrelationTableProps) {
  if (!data || data.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
    >
      <div className="overflow-x-auto">
        <table className="table-pin-first w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2.5 px-3 text-right text-slate-500 font-medium">שנה</th>
              <th className="py-2.5 px-3 text-right text-slate-500 font-medium">גידול אוכלוסייה %</th>
              <th className="py-2.5 px-3 text-right text-slate-500 font-medium">
                דירות נדרשות
                {avgHouseholdSize && (
                  <span className="text-slate-400 block text-2xs">
                    (לפי {avgHouseholdSize.toFixed(1)} נפשות/משק בית)
                  </span>
                )}
              </th>
              <th className="py-2.5 px-3 text-right text-slate-500 font-medium">היתרי בנייה</th>
              <th className="py-2.5 px-3 text-right text-slate-500 font-medium">התחלות בנייה</th>
              <th className="py-2.5 px-3 text-right text-slate-500 font-medium">פער (היתרים - נדרש)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const gap =
                row.buildingPermits !== null && row.requiredHouseholds !== null
                  ? row.buildingPermits - row.requiredHouseholds
                  : null;
              const gapColor = getGapColor(row.buildingPermits, row.requiredHouseholds);

              return (
                <tr key={row.year} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3 text-slate-700 font-bold">{row.year}</td>
                  <td className={`py-2.5 px-3 ${
                    row.populationGrowthPct !== null && row.populationGrowthPct >= 0
                      ? "text-emerald-700"
                      : "text-red-600"
                  }`}>
                    {fmtPct(row.populationGrowthPct)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-700">{fmt(row.requiredHouseholds)}</td>
                  <td className="py-2.5 px-3 text-slate-700">{fmt(row.buildingPermits)}</td>
                  <td className="py-2.5 px-3 text-slate-700">{fmt(row.constructionStarts)}</td>
                  <td className={`py-2.5 px-3 font-bold ${gapColor}`}>
                    {gap !== null ? `${gap >= 0 ? "+" : ""}${fmt(gap)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 mt-3 text-2xs text-slate-400">
        <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 ml-1"></span>עודף (היתרים &gt; נדרש)</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-slate-400 ml-1"></span>קרוב לאיזון</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-red-400 ml-1"></span>גרעון (היתרים &lt; נדרש)</span>
      </div>
    </motion.div>
  );
}
