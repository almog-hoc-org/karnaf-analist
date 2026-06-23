import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

interface PageProps {
  params: { type: string };
}

// ── Ranking configurations ─────────────────────────────────────────
type RankingType = "most-expensive" | "highest-gain" | "highest-surplus" | "highest-inventory";

const RANKING_CONFIG: Record<RankingType, {
  title: string;
  subtitle: string;
  icon: string;
  accent: "amber" | "rose" | "emerald" | "cyan";
  valueLabel: string;
  source: string;
}> = {
  "most-expensive": {
    title: "מחיר חציוני גבוה ביותר",
    subtitle: "כל הערים מסודרות לפי מחיר חציוני של דירה (Q1/2025)",
    icon: "👑",
    accent: "amber",
    valueLabel: "מחיר חציוני",
    source: "nadlan.gov.il — רשות המסים",
  },
  "highest-gain": {
    title: "עליית מחיר גבוהה ביותר",
    subtitle: "כל הערים מסודרות לפי שינוי מחיר 2023→2026",
    icon: "📈",
    accent: "rose",
    valueLabel: "שינוי מחיר",
    source: 'למ"ס + nadlan.gov.il',
  },
  "highest-surplus": {
    title: "עודף היצע הגבוה ביותר",
    subtitle: "כל הערים מסודרות לפי יחס בנייה / דירות נדרשות",
    icon: "🏗️",
    accent: "emerald",
    valueLabel: "עודף היצע",
    source: 'למ"ס + חישוב מקומי',
  },
  "highest-inventory": {
    title: "מלאי דירות לא מכורות",
    subtitle: "כל הערים עם נתוני מלאי, מסודרות לפי מלאי דירות 2025",
    icon: "🏘️",
    accent: "cyan",
    valueLabel: "מלאי דירות",
    source: 'למ"ס',
  },
};

const accentClasses = {
  amber: {
    icon: "bg-amber-100 text-amber-700",
    bar: "from-amber-500 to-amber-600",
    value: "text-amber-700",
  },
  rose: {
    icon: "bg-rose-100 text-rose-700",
    bar: "from-rose-500 to-rose-600",
    value: "text-rose-700",
  },
  emerald: {
    icon: "bg-emerald-100 text-emerald-700",
    bar: "from-emerald-500 to-emerald-600",
    value: "text-emerald-700",
  },
  cyan: {
    icon: "bg-cyan-100 text-cyan-700",
    bar: "from-cyan-500 to-cyan-600",
    value: "text-cyan-700",
  },
};

// ── Data fetchers ──────────────────────────────────────────────────
async function fetchData(type: RankingType): Promise<Array<{ city: string; value: number; formatted: string }>> {
  if (type === "most-expensive") {
    const rows = await prisma.nadlan_price_trends.findMany({
      where: { quarter: 1, year: 2025, median_price: { not: null } },
      orderBy: { median_price: "desc" },
      select: { city_name: true, median_price: true },
    });
    return rows.map((r) => ({
      city: r.city_name,
      value: r.median_price ?? 0,
      formatted: `₪${Math.round(r.median_price!).toLocaleString("he-IL")}`,
    }));
  }
  if (type === "highest-gain") {
    const rows = await prisma.city.findMany({
      where: { price_change_pct: { not: null } },
      orderBy: { price_change_pct: "desc" },
      select: { city_name: true, price_change_pct: true },
    });
    return rows.map((r) => ({
      city: r.city_name,
      value: r.price_change_pct ?? 0,
      formatted: `${(r.price_change_pct ?? 0) >= 0 ? "+" : ""}${r.price_change_pct!.toFixed(1)}%`,
    }));
  }
  if (type === "highest-surplus") {
    const rows = await prisma.city.findMany({
      where: { golden_pct: { not: null } },
      orderBy: { golden_pct: "desc" },
      select: { city_name: true, golden_pct: true },
    });
    return rows.map((r) => ({
      city: r.city_name,
      value: r.golden_pct ?? 0,
      formatted: `${(r.golden_pct ?? 0) >= 0 ? "+" : ""}${r.golden_pct!.toFixed(1)}%`,
    }));
  }
  // highest-inventory
  const rows = await prisma.citySales.findMany({
    where: { unsold_inventory_2025: { not: null } },
    orderBy: { unsold_inventory_2025: "desc" },
    select: { city_name: true, unsold_inventory_2025: true },
  });
  return rows.map((r) => ({
    city: r.city_name,
    value: r.unsold_inventory_2025 ?? 0,
    formatted: r.unsold_inventory_2025!.toLocaleString("he-IL"),
  }));
}

export async function generateStaticParams() {
  return Object.keys(RANKING_CONFIG).map((type) => ({ type }));
}

export async function generateMetadata({ params }: PageProps) {
  const cfg = RANKING_CONFIG[params.type as RankingType];
  return { title: cfg ? `${cfg.title} | מחקר נדל"ן ישראל` : "דירוג" };
}

export default async function RankingPage({ params }: PageProps) {
  const type = params.type as RankingType;
  const cfg = RANKING_CONFIG[type];
  if (!cfg) notFound();

  const data = await fetchData(type);
  const a = accentClasses[cfg.accent];
  const maxValue = Math.max(...data.map((d) => Math.abs(d.value)));

  return (
    <main className="min-h-screen px-4 py-8 max-w-5xl mx-auto">
      {/* Top nav */}
      <nav className="flex items-center justify-between mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-cyan-700 transition-colors"
        >
          <span>←</span>
          <span>חזרה לדף הבית</span>
        </Link>
        <Link href="/cities" className="text-sm text-slate-600 hover:text-cyan-700 transition-colors">
          טבלת ערים מלאה ←
        </Link>
      </nav>

      {/* Header */}
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${a.icon}`}
          >
            {cfg.icon}
          </div>
          <div className="flex-1">
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-tight">
              {cfg.title}
            </h1>
            <p className="text-slate-600 text-base mt-1">{cfg.subtitle}</p>
            <div className="flex flex-wrap gap-3 mt-3 text-sm">
              <span className="px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-700 tabular-nums shadow-sm">
                <span className="font-bold text-slate-900">{data.length}</span>
                <span className="text-slate-500 mr-1.5">ערים</span>
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-500 text-xs">
                מקור: {cfg.source}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Full table */}
      <div className="glass-card overflow-hidden">
        <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums" dir="rtl">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="py-3 px-4 text-right text-xs text-slate-500 font-semibold w-16">דירוג</th>
                <th className="py-3 px-4 text-right text-xs text-slate-500 font-semibold">עיר</th>
                <th className="py-3 px-4 text-left text-xs text-slate-500 font-semibold">{cfg.valueLabel}</th>
                <th className="py-3 px-4 text-left text-xs text-slate-500 font-semibold w-40">השוואה ויזואלית</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => {
                const rank = idx + 1;
                const pct = maxValue > 0 ? Math.min(100, (Math.abs(row.value) / maxValue) * 100) : 0;
                const rankBadge =
                  rank === 1
                    ? "bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-md shadow-amber-500/30"
                    : rank === 2
                    ? "bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow"
                    : rank === 3
                    ? "bg-gradient-to-br from-amber-600 to-amber-700 text-white shadow"
                    : "bg-slate-100 text-slate-600 border border-slate-200";

                return (
                  <tr
                    key={row.city}
                    className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                      rank === 1 ? "bg-amber-50/40" : ""
                    }`}
                  >
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black ${rankBadge}`}
                      >
                        {rank}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/city/${encodeURIComponent(row.city)}`}
                        className={`font-semibold text-slate-900 hover:text-cyan-700 transition-colors ${
                          rank === 1 ? "text-base" : "text-sm"
                        }`}
                      >
                        {row.city}
                      </Link>
                    </td>
                    <td className={`py-3 px-4 text-left font-bold ${a.value} ${rank === 1 ? "text-lg" : ""}`}>
                      {row.formatted}
                    </td>
                    <td className="py-3 px-4">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-gradient-to-l ${a.bar} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Related rankings */}
      <div className="mt-10">
        <h2 className="text-sm font-bold text-slate-900 mb-3">דירוגים אחרים</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.keys(RANKING_CONFIG) as RankingType[])
            .filter((t) => t !== type)
            .map((t) => {
              const o = RANKING_CONFIG[t];
              const oa = accentClasses[o.accent];
              return (
                <Link
                  key={t}
                  href={`/rankings/${t}`}
                  className="glass-card p-3 flex items-center gap-2 hover:border-cyan-300 transition-all group"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${oa.icon}`}>
                    {o.icon}
                  </div>
                  <span className="text-xs font-semibold text-slate-900 group-hover:text-cyan-700 transition-colors leading-tight">
                    {o.title}
                  </span>
                </Link>
              );
            })}
        </div>
      </div>
    </main>
  );
}
