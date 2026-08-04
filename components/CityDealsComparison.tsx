"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { withBasePath } from "@/lib/basePath";
import Icon from "@/components/Icon";

// ── Types ────────────────────────────────────────────────────────

interface AggregatedSample {
  type: "aggregated";
  count: number;
  threshold: 15 | 10 | 5 | 2 | 1;
  avgPricePerSqm: number;
  avgTotalPrice: number;
  avgArea: number;
}

interface SingleSample {
  type: "single";
  pricePerSqm: number;
  totalPrice: number;
  area: number;
  houseNum: number | null;
  streetName: string;
  blocksAway: number;
  dealDate: string;
}

type DealSample = AggregatedSample | SingleSample;

interface PeriodData {
  period: "current" | "minus3" | "minus5";
  year: number;
  sample: DealSample | null;
}

interface SizeBucketResult {
  label: string;
  targetArea: number;
  minArea: number;
  maxArea: number;
  periods: PeriodData[];
}

interface StreetComparison {
  streetName: string;
  totalDeals: number;
  sizeBuckets: SizeBucketResult[];
}

interface NeighborhoodComparison {
  neighborhood: string;
  totalDeals: number;
  dealsPerYearAvg: number;
  streets: StreetComparison[];
}

interface CityDealsData {
  cityName: string;
  lastUpdated: string;
  neighborhoods: NeighborhoodComparison[];
  totalDealsAnalyzed: number;
  periodYears: { current: number; minus3: number; minus5: number };
  townCharacter: string;
  note?: string;
}

// ── Formatters ───────────────────────────────────────────────────

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) {
    return `₪${(value / 1_000_000).toFixed(2)}M`;
  }
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

function formatPricePerSqm(value: number | null): string {
  if (value === null) return "—";
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

function calcChange(oldVal: number | null, newVal: number | null): number | null {
  if (!oldVal || !newVal || oldVal <= 0) return null;
  return ((newVal - oldVal) / oldVal) * 100;
}

function getSamplePricePerSqm(sample: DealSample | null): number | null {
  if (!sample) return null;
  return sample.type === "aggregated" ? sample.avgPricePerSqm : sample.pricePerSqm;
}

function getSampleTotalPrice(sample: DealSample | null): number | null {
  if (!sample) return null;
  return sample.type === "aggregated" ? sample.avgTotalPrice : sample.totalPrice;
}

// ── UI subcomponents ─────────────────────────────────────────────

function ChangeTag({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400 text-2xs">—</span>;
  const isPositive = value >= 0;
  const color = isPositive ? "text-emerald-700" : "text-red-600";
  const bg = isPositive ? "bg-emerald-50" : "bg-red-50";
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-2xs font-bold px-2 py-0.5 rounded-full ${bg} ${color}`}
    >
      {isPositive ? "▲" : "▼"} {isPositive ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

function SampleBadge({ sample }: { sample: DealSample | null }) {
  if (!sample) return null;
  if (sample.type === "aggregated") {
    // Sample-quality ladder on the brand scale: deeper indigo = larger sample.
    const colorMap: Record<number, string> = {
      15: "bg-indigo-100 text-indigo-800 border-indigo-300",
      10: "bg-indigo-50 text-indigo-700 border-indigo-200",
      5: "bg-slate-200 text-slate-700 border-slate-300",
      2: "bg-slate-100 text-slate-600 border-slate-300",
      1: "bg-slate-100 text-slate-700 border-slate-200",
    };
    return (
      <span
        className={`inline-block text-2xs font-medium px-1.5 py-0.5 rounded border ${colorMap[sample.threshold]}`}
        title={`ממוצע של ${sample.count} עסקאות`}
      >
        ממוצע {sample.count}
      </span>
    );
  }
  // single sample
  return (
    <span
      className="inline-block text-2xs font-medium px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200"
      title={`עסקה בודדת — ${sample.area} מ"ר, ${sample.blocksAway === 0 ? "אותה כתובת" : `מרחק ${sample.blocksAway} בלוקים`}`}
    >
      עסקה בודדת
    </span>
  );
}

function SampleCell({
  sample,
  isLatest,
}: {
  sample: DealSample | null;
  isLatest: boolean;
}) {
  if (!sample) {
    return (
      <td className="px-2 py-2.5 text-center">
        <span className="text-2xs text-slate-400">—</span>
      </td>
    );
  }
  const ppsm = getSamplePricePerSqm(sample);
  const total = getSampleTotalPrice(sample);
  return (
    <td className="px-2 py-2.5 text-center">
      <div className={`text-2xs font-bold ${isLatest ? "text-indigo-700" : "text-slate-900"}`}>
        {formatPricePerSqm(ppsm)}
      </div>
      <div className="text-2xs text-slate-500 mt-0.5">{formatPrice(total)}</div>
      <div className="mt-1">
        <SampleBadge sample={sample} />
      </div>
    </td>
  );
}

function StreetTable({
  street,
  periodYears,
}: {
  street: StreetComparison;
  periodYears: { current: number; minus3: number; minus5: number };
}) {
  // Order columns: -5y, -3y, current  (chronological, left → right; in RTL the right side is "older")
  const orderedPeriods: ("minus5" | "minus3" | "current")[] = ["minus5", "minus3", "current"];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" dir="rtl">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="px-3 py-2.5 text-right text-2xs text-slate-500 font-medium w-24 whitespace-nowrap">
              גודל
            </th>
            {orderedPeriods.map((p) => {
              const year = periodYears[p];
              const isLatest = p === "current";
              return (
                <th
                  key={p}
                  className={`px-2 py-2.5 text-center text-2xs font-medium whitespace-nowrap ${
                    isLatest ? "text-indigo-700" : "text-slate-500"
                  }`}
                >
                  {year}
                  {isLatest && <span className="text-2xs block">היום</span>}
                  {p === "minus3" && <span className="text-2xs block text-slate-400">לפני 3 שנים</span>}
                  {p === "minus5" && <span className="text-2xs block text-slate-400">לפני 5 שנים</span>}
                </th>
              );
            })}
            <th className="px-2 py-2.5 text-center text-2xs text-slate-500 font-medium whitespace-nowrap">
              שינוי
            </th>
          </tr>
        </thead>
        <tbody>
          {street.sizeBuckets.map((bucket) => {
            const samples = orderedPeriods.map(
              (p) => bucket.periods.find((x) => x.period === p)?.sample ?? null
            );
            const oldestWithData = samples.find((s) => s !== null);
            const latestSample = samples[samples.length - 1];
            const change = calcChange(
              getSamplePricePerSqm(oldestWithData ?? null),
              getSamplePricePerSqm(latestSample)
            );

            return (
              <tr
                key={bucket.targetArea}
                className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
              >
                <td className="px-3 py-2.5 text-2xs text-slate-700 font-medium whitespace-nowrap">
                  {bucket.label}
                </td>
                {orderedPeriods.map((p, idx) => {
                  const sample = bucket.periods.find((x) => x.period === p)?.sample ?? null;
                  return (
                    <SampleCell
                      key={p}
                      sample={sample}
                      isLatest={idx === orderedPeriods.length - 1}
                    />
                  );
                })}
                <td className="px-2 py-2.5 text-center">
                  <ChangeTag value={change} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StreetBlock({
  street,
  periodYears,
}: {
  street: StreetComparison;
  periodYears: { current: number; minus3: number; minus5: number };
}) {
  return (
    <div className="border-t border-slate-100">
      <div className="px-5 py-2 flex items-center justify-between bg-slate-50">
        <span className="text-xs text-slate-700 font-medium"><Icon name="map" size="1em" /> רחוב {street.streetName}</span>
        <span className="text-2xs text-slate-500">{street.totalDeals} עסקאות ברחוב</span>
      </div>
      <StreetTable street={street} periodYears={periodYears} />
    </div>
  );
}

function NeighborhoodCard({
  nh,
  periodYears,
}: {
  nh: NeighborhoodComparison;
  periodYears: { current: number; minus3: number; minus5: number };
}) {
  if (nh.streets.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass-card overflow-hidden"
    >
      <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
        <div className="flex flex-wrap gap-y-1 items-center justify-between">
          <h3 className="min-w-0 text-sm font-bold text-slate-900">שכונת {nh.neighborhood}</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 px-2 py-0.5 rounded-full bg-slate-100">
              {nh.totalDeals} עסקאות
            </span>
            <span
              className="text-xs text-indigo-700 px-2 py-0.5 rounded-full bg-indigo-50"
              title="ממוצע עסקאות לשנה"
            >
              ~{nh.dealsPerYearAvg}/שנה
            </span>
          </div>
        </div>
      </div>

      <div>
        {nh.streets.map((street) => (
          <StreetBlock key={street.streetName} street={street} periodYears={periodYears} />
        ))}
      </div>
    </motion.div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="glass-card overflow-hidden animate-pulse">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <div className="h-4 w-40 bg-slate-100 rounded" />
          </div>
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((j) => (
              <div key={j} className="flex gap-3">
                <div className="h-3 w-14 bg-slate-100 rounded" />
                <div className="h-3 w-12 bg-slate-100 rounded" />
                <div className="h-3 w-12 bg-slate-100 rounded" />
                <div className="h-3 w-12 bg-slate-100 rounded" />
                <div className="h-3 w-10 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-400 text-center animate-pulse">
        טוען עסקאות נדל&quot;ן מרשות המסים...
      </p>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function CityDealsComparison({ cityName }: { cityName: string }) {
  const [data, setData] = useState<CityDealsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDeals() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(withBasePath(`/api/city-deals/${encodeURIComponent(cityName)}`));
        if (!res.ok) throw new Error("Failed to fetch");
        const result = await res.json();
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setError("שגיאה בטעינת נתוני עסקאות");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDeals();
    return () => {
      cancelled = true;
    };
  }, [cityName]);

  return (
    <section className="mb-10">
      <div className="section-header mb-4">
        <div className="section-header-icon"><Icon name="building" size="1em" /></div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-slate-900">
            עסקאות אמיתיות — השוואת מחירים ברחוב
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            השוואת מחיר/מ&quot;ר היום מול לפני 3 ו-5 שנים, באותה שכונה ובאותו רחוב
            <span className="text-slate-400"> | מקור: govmap.gov.il — רשות המסים</span>
          </p>
        </div>
      </div>

      {loading && <LoadingSkeleton />}

      {error && (
        <div className="glass-card border-red-300 p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              fetch(withBasePath(`/api/city-deals/${encodeURIComponent(cityName)}`))
                .then((r) => r.json())
                .then(setData)
                .catch(() => setError("שגיאה בטעינת נתוני עסקאות"))
                .finally(() => setLoading(false));
            }}
            className="mt-2 text-xs text-slate-500 hover:text-indigo-700 transition-colors underline"
          >
            נסה שוב
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.neighborhoods.length > 0 ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-2xs">
                <span className="text-slate-500">מקרא:</span>
                <span className="px-1.5 py-0.5 rounded border bg-indigo-100 text-indigo-800 border-indigo-300">
                  ממוצע 15+ עסקאות
                </span>
                <span className="px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200">
                  ממוצע 10+
                </span>
                <span className="px-1.5 py-0.5 rounded border bg-slate-200 text-slate-700 border-slate-300">
                  ממוצע 5+
                </span>
                <span className="px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-300">
                  ממוצע 2+
                </span>
                <span className="px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
                  עסקה בודדת (±15% גודל)
                </span>
              </div>

              <div className="space-y-4">
                {data.neighborhoods.map((nh) => (
                  <NeighborhoodCard
                    key={nh.neighborhood}
                    nh={nh}
                    periodYears={data.periodYears}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="glass-card p-8 text-center">
              <p className="text-slate-500 text-sm">
                אין מספיק עסקאות להשוואה ב{cityName}
              </p>
              <p className="text-slate-400 text-xs mt-1">
                נדרשות לפחות 5 עסקאות באותו רחוב + גודל + שנה, או עסקה בודדת בכתובת תואמת
              </p>
            </div>
          )}

          {data.totalDealsAnalyzed > 0 && (
            <div className="mt-3 flex flex-wrap gap-y-1 items-center justify-between text-2xs text-slate-400">
              <span>
                סה&quot;כ {data.totalDealsAnalyzed} עסקאות נותחו | אופי יישוב: {data.townCharacter}
              </span>
              <span>
                עודכן: {new Date(data.lastUpdated).toLocaleDateString("he-IL")}
              </span>
            </div>
          )}

          <p className="text-2xs text-slate-400 mt-2">
            * נתונים מבוססים על עסקאות שדווחו לרשות המסים (nadlan.gov.il). מחיר
            למ&quot;ר אחרי סינון חריגים (±2 ס.ת.). תאי טבלה ריקים = אין נתון אמין —
            לא מוצג מספר מומצא.
          </p>
        </>
      )}
    </section>
  );
}
