import { prisma } from "@/lib/db";
import { getCityInsights } from "@/lib/insights";
import PriceChart from "@/components/PriceChart";
import SalesChart from "@/components/SalesChart";
import Link from "next/link";
import { notFound } from "next/navigation";

interface PageProps {
  params: { slug: string };
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null, decimals = 2): string {
  if (value === null) return "—";
  return value.toFixed(decimals);
}

export async function generateMetadata({ params }: PageProps) {
  const cityName = decodeURIComponent(params.slug);
  return {
    title: `${cityName} | מחקר נדל"ן ישראל`,
  };
}

export default async function CityPage({ params }: PageProps) {
  const cityName = decodeURIComponent(params.slug);

  const [city, salesData, buildingPermits, insights] = await Promise.all([
    prisma.city.findUnique({
      where: { city_name: cityName },
    }),
    prisma.citySales.findUnique({
      where: { city_name: cityName },
    }),
    prisma.buildingPermit.findMany({
      where: { city_name: cityName },
      orderBy: { year: "asc" },
    }),
    getCityInsights(cityName),
  ]);

  if (!city) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-5xl mb-4">🔍</p>
          <h1 className="text-2xl font-bold text-zinc-100">העיר לא נמצאה</h1>
          <p className="text-zinc-400">
            לא נמצאו נתונים עבור &ldquo;{cityName}&rdquo;
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-300 hover:border-cyan-700 hover:text-cyan-400 transition-all"
          >
            ← חזרה לדף הבית
          </Link>
        </div>
      </main>
    );
  }

  const formattedLastUpdated = city.last_updated
    ? city.last_updated.toLocaleDateString("he-IL", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "לא ידוע";

  const insightEntries: { key: string; text: string; icon: string }[] = [
    insights.priceChange
      ? { key: "price", text: insights.priceChange, icon: "📈" }
      : null,
    insights.supplyBalance
      ? { key: "supply", text: insights.supplyBalance, icon: "⚖️" }
      : null,
    insights.inventoryClearance
      ? { key: "inventory", text: insights.inventoryClearance, icon: "🏘️" }
      : null,
    insights.peoplePerApartment
      ? { key: "people", text: insights.peoplePerApartment, icon: "👥" }
      : null,
    insights.buildingPermitsTrend
      ? { key: "permits", text: insights.buildingPermitsTrend, icon: "🏗️" }
      : null,
  ].filter(Boolean) as { key: string; text: string; icon: string }[];

  const priceChangePct = city.price_change_pct ?? 0;
  const priceChangeColor =
    priceChangePct >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <main className="min-h-screen px-4 py-10 max-w-5xl mx-auto">
      {/* ── Back button ──────────────────────────────────────────────── */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 mb-8 text-sm text-zinc-400 hover:text-cyan-400 transition-colors"
      >
        ← חזרה לדף הבית
      </Link>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="mb-10">
        <p className="text-xs font-medium tracking-widest text-cyan-500 uppercase mb-2">
          City Report
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-1">
          {city.city_name}
        </h1>
      </header>

      {/* ── KPI Tiles ────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <KpiTile
          label='מחיר למ"ר 2026'
          value={formatPrice(city.price_per_sqm_2026)}
          unit='₪/מ"ר'
          accent="cyan"
        />
        <KpiTile
          label="שינוי מחיר 2023→2026"
          value={formatPct(city.price_change_pct)}
          accent={priceChangePct >= 0 ? "emerald" : "red"}
          valueClassName={priceChangeColor}
        />
        <KpiTile
          label="מכפיל הזהב"
          value={formatNumber(city.golden_multiplier)}
          accent="purple"
        />
        <KpiTile
          label="נפשות לדירה"
          value={formatNumber(city.people_per_apartment, 1)}
          accent="amber"
        />
      </section>

      {/* ── Charts ───────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-400 mb-4">
            מחיר למ&quot;ר — 2023 מול 2026
          </h2>
          <PriceChart
            price2023={city.price_per_sqm_2023}
            price2026={city.price_per_sqm_2026}
            cityName={city.city_name}
          />
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-400 mb-4">
            עסקאות חדשות לפי שנה
          </h2>
          <SalesChart
            sales2023={salesData?.new_sales_2023 ?? null}
            sales2024={salesData?.new_sales_2024 ?? null}
            sales2025={salesData?.new_sales_2025 ?? null}
          />
        </div>
      </section>

      {/* ── Inventory clearance callout ──────────────────────────────── */}
      {salesData?.years_to_clear_avg !== null &&
        salesData?.years_to_clear_avg !== undefined && (
          <section className="mb-10">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-400 mb-1">
                  זמן פינוי מלאי ממוצע
                </p>
                <p className="text-3xl font-bold text-cyan-400">
                  {salesData.years_to_clear_avg.toFixed(1)}{" "}
                  <span className="text-lg font-normal text-zinc-400">
                    שנים
                  </span>
                </p>
              </div>
              <div className="text-5xl opacity-30">🕐</div>
            </div>
          </section>
        )}

      {/* ── Insights panel ───────────────────────────────────────────── */}
      {insightEntries.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-zinc-200 mb-4">
            תובנות עיקריות
          </h2>
          <div className="grid grid-cols-1 gap-3">
            {insightEntries.map((insight) => (
              <div
                key={insight.key}
                className="flex items-start gap-3 px-5 py-4 bg-zinc-900 border border-zinc-800 rounded-xl"
              >
                <span className="text-xl flex-shrink-0 mt-0.5">
                  {insight.icon}
                </span>
                <p className="text-zinc-200 text-sm leading-relaxed">
                  {insight.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Building permits table ───────────────────────────────────── */}
      {buildingPermits.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-zinc-200 mb-4">
            היתרי בנייה לפי שנה
          </h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="px-5 py-3 text-right text-zinc-400 font-medium">
                    שנה
                  </th>
                  <th className="px-5 py-3 text-right text-zinc-400 font-medium">
                    היתרים
                  </th>
                </tr>
              </thead>
              <tbody>
                {buildingPermits.map((permit) => (
                  <tr
                    key={permit.id}
                    className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/50 transition-colors"
                  >
                    <td className="px-5 py-3 text-zinc-300">{permit.year}</td>
                    <td className="px-5 py-3 text-zinc-100 font-medium">
                      {permit.permits !== null
                        ? permit.permits.toLocaleString("he-IL")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="pt-8 border-t border-zinc-800 text-center text-zinc-500 text-sm">
        מקור: קובץ מחקר פנימי | עודכן לאחרונה: {formattedLastUpdated}
      </footer>
    </main>
  );
}

// ── KPI Tile ──────────────────────────────────────────────────────────────────

type AccentColor = "cyan" | "purple" | "emerald" | "amber" | "red";

function KpiTile({
  label,
  value,
  unit,
  accent = "cyan",
  valueClassName,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: AccentColor;
  valueClassName?: string;
}) {
  const accentMap: Record<AccentColor, string> = {
    cyan: "text-cyan-400",
    purple: "text-purple-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
  };

  const accentBorderMap: Record<AccentColor, string> = {
    cyan: "border-cyan-900/50",
    purple: "border-purple-900/50",
    emerald: "border-emerald-900/50",
    amber: "border-amber-900/50",
    red: "border-red-900/50",
  };

  const colorClass = valueClassName ?? accentMap[accent];

  return (
    <div
      className={`bg-zinc-900 border rounded-xl p-4 space-y-1 ${accentBorderMap[accent]}`}
    >
      <p className="text-xs text-zinc-500 font-medium">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
      {unit && <p className="text-xs text-zinc-500">{unit}</p>}
    </div>
  );
}
