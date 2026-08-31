import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { computeAllInvestorMetrics } from "@/lib/investorMetrics";
import { refYear } from "@/lib/refYear";
import { loadSecondhandChanges } from "@/lib/cityChangeMetrics";
import { loadCityTransactionPrices, loadRankingEligibleCities, rankingEligibilityNote } from "@/lib/cityTransactionPrices";
import { computeAllCityGaps } from "@/lib/gap-analysis";
import Icon from "@/components/Icon";
import { fromToText } from "@/components/FromTo";

interface PageProps {
  params: { type: string };
}

import { RANKING_TITLES, type RankingType } from "@/lib/rankingMeta";

// ── Ranking configurations ─────────────────────────────────────────
// Titles live in lib/rankingMeta so the admin usage dashboard can label a
// ranking with the same words the page uses. Subtitles stay here because they
// interpolate refYear(), which must not be frozen at module load.

const RANKING_CONFIG: Record<RankingType, {
  title: string;
  subtitle: string;
  icon: string;
  accent: "amber" | "rose" | "emerald" | "cyan" | "indigo";
  valueLabel: string;
  source: string;
}> = {
  "new-premium": {
    title: RANKING_TITLES["new-premium"],
    subtitle: `ערים שבהן דירה חדשה קרובה במחירה ליד-שנייה (₪/מ"ר, לפי שנת בנייה, עד ${refYear()})`,
    icon: "🆕",
    accent: "indigo",
    valueLabel: "פרמיית חדשות",
    source: "מאגר העסקאות הפנימי — פילוח שנת בנייה",
  },
  "most-expensive": {
    title: RANKING_TITLES["most-expensive"],
    subtitle: `חציון ₪/מ"ר של עסקאות יד-שנייה אמיתיות (שנה מלאה אחרונה עם 10+ עסקאות)`,
    icon: "crown",
    accent: "amber",
    valueLabel: 'חציון יד-2 ₪/מ"ר',
    source: "מאגר העסקאות הפנימי (רשות המסים)",
  },
  "highest-gain": {
    title: RANKING_TITLES["highest-gain"],
    subtitle: `שינוי ממוצע ₪/מ"ר של עסקאות יד-שנייה, 3 שנים (2025 ← 2022, 10+ עסקאות בשתי השנים) — ללא הטיית דירות חדשות`,
    icon: "trend-up",
    accent: "rose",
    valueLabel: "שינוי יד-2 3 שנים",
    source: "מאגר העסקאות הפנימי (רשות המסים) — לפי שנת בנייה",
  },
  "highest-gain-median": {
    title: RANKING_TITLES["highest-gain-median"],
    subtitle: `שינוי חציון ₪/מ"ר של עסקאות יד-שנייה, 3 שנים (2025 ← 2022, 10+ עסקאות בשתי השנים)`,
    icon: "chart",
    accent: "rose",
    valueLabel: "שינוי חציון יד-2 3 שנים",
    source: "מאגר העסקאות הפנימי (רשות המסים) — לפי שנת בנייה",
  },
  "highest-surplus": {
    title: RANKING_TITLES["highest-surplus"],
    subtitle: "היצע חדש מול ביקוש (למ\"ס: השלמות/התחלות/היתרים מול גידול משקי-בית) — שלילי = עודף",
    icon: "construction",
    accent: "emerald",
    valueLabel: "עודף/מחסור % מהביקוש",
    source: 'למ"ס — חישוב פער היצע',
  },
  "highest-inventory": {
    title: RANKING_TITLES["highest-inventory"],
    subtitle: "כל הערים עם נתוני מלאי, מסודרות לפי מלאי דירות 2025",
    icon: "building",
    accent: "cyan",
    valueLabel: "מלאי דירות",
    source: 'למ"ס',
  },
};

// Unified brand accent — all ranking pages share the same indigo chrome.
// Values are neutral ink; trend rankings color the value per-row (emerald/red).
const INDIGO_ACCENT = {
  icon: "bg-indigo-50 text-indigo-700",
  bar: "from-indigo-500 to-indigo-600",
  value: "text-slate-900",
};
const accentClasses = {
  amber: INDIGO_ACCENT,
  rose: INDIGO_ACCENT,
  emerald: INDIGO_ACCENT,
  cyan: INDIGO_ACCENT,
  indigo: INDIGO_ACCENT,
};

// ── Data fetchers ──────────────────────────────────────────────────
const signed = (v: number, suffix: string) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}${suffix}`;

/** new-premium ranking — ascending: the LOWEST premium leads (new almost at second-hand price) */
async function fetchNewPremiumRanking() {
  const pool = [...(await computeAllInvestorMetrics()).values()].filter((m) => m.confidence !== "low");
  return pool
    .filter((m) => m.newPremiumPct != null)
    .sort((a, b) => (a.newPremiumPct ?? 0) - (b.newPremiumPct ?? 0))
    .map((m) => ({ city: m.cityName, value: m.newPremiumPct!, formatted: signed(m.newPremiumPct!, "%") }));
}

async function fetchData(type: RankingType): Promise<Array<{ city: string; value: number; formatted: string; sub?: string | null }>> {
  if (type === "new-premium") {
    return fetchNewPremiumRanking();
  }
  if (type === "most-expensive") {
    // Second-hand median ₪/m² from REAL transactions (not the old official quarter table)
    const prices = await loadCityTransactionPrices();
    return [...prices.values()]
      .filter((p) => p.medianShSqm != null)
      .sort((a, b) => (b.medianShSqm ?? 0) - (a.medianShSqm ?? 0))
      .map((p) => ({
        city: p.cityName,
        value: p.medianShSqm!,
        formatted: `₪${p.medianShSqm!.toLocaleString("he-IL")}/מ"ר`,
        sub: p.priceYear ? String(p.priceYear) : null,
      }));
  }
  if (type === "highest-gain" || type === "highest-gain-median") {
    // Second-hand ONLY (user rule): an old city gaining one new expensive
    // neighborhood must not look like a market-wide price jump.
    const rows = await loadSecondhandChanges(3, type === "highest-gain" ? "avg_sqm" : "median_sqm");
    return rows.map((r) => ({
      city: r.city_name,
      value: r.pct,
      formatted: `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%`,
      sub: fromToText(r.fromY, r.toY),
    }));
  }
  if (type === "highest-surplus") {
    // CBS supply-vs-demand gap (replaces the old-Excel golden_pct): negative
    // gap = supply exceeded demand. Rank most-surplus first.
    const gaps = await computeAllCityGaps();
    return gaps
      .filter((g) => g.totals.gapPctOfDemand != null && Math.abs(g.totals.gapPctOfDemand) <= 400)
      .sort((a, b) => (a.totals.gapPctOfDemand ?? 0) - (b.totals.gapPctOfDemand ?? 0))
      .map((g) => ({
        city: g.cityName,
        value: -(g.totals.gapPctOfDemand ?? 0), // positive value = surplus, for the trend coloring
        formatted: `${(g.totals.gapPctOfDemand ?? 0) > 0 ? "מחסור " : "עודף "}${Math.abs(g.totals.gapPctOfDemand ?? 0).toFixed(0)}%`,
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
  return { title: cfg ? `${cfg.title} | קרנף אנליסט` : "דירוג" };
}

export default async function RankingPage({ params }: PageProps) {
  const type = params.type as RankingType;
  const cfg = RANKING_CONFIG[type];
  if (!cfg) notFound();

  const eligible = await loadRankingEligibleCities();
  const data = (await fetchData(type)).filter((d) => eligible.has(d.city));
  const a = accentClasses[cfg.accent];
  const maxValue = Math.max(...data.map((d) => Math.abs(d.value)));
  // Signed %-change rankings are genuine trends — color per row direction.
  const isTrendRanking = type === "highest-gain" || type === "highest-gain-median" || type === "highest-surplus";

  return (
    <main className="min-h-screen page-wrap py-8">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${a.icon}`}
          >
            {/* was {cfg.icon} — the config holds glyph NAMES ("crown",
                "building"), so the box rendered the literal English word.
                Found by scripts/audit-line-overflow.ts, which flagged the
                text overflowing its 56px box. */}
            <Icon name={cfg.icon} size="1em" />
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
              <span className="px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-2xs font-semibold">
                <Icon name="scale" size="1em" /> {rankingEligibilityNote()}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Full table */}
      <div className="glass-card overflow-hidden">
        <div className={`h-1 bg-gradient-to-l ${a.bar}`} />
        <div className="overflow-x-auto">
          <table className="table-pin-first w-full text-sm tabular-nums" dir="rtl">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="py-3 px-4 text-right text-xs text-slate-500 font-semibold w-16">דירוג</th>
                <th className="py-3 px-4 text-right text-xs text-slate-500 font-semibold">עיר</th>
                <th className="py-3 px-4 text-left text-xs text-slate-500 font-semibold">{cfg.valueLabel}</th>
                <th className="py-3 px-4 text-left text-xs text-slate-500 font-semibold w-24 md:w-40">השוואה ויזואלית</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => {
                const rank = idx + 1;
                const pct = maxValue > 0 ? Math.min(100, (Math.abs(row.value) / maxValue) * 100) : 0;
                const rankBadge =
                  rank === 1
                    ? "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/30"
                    : rank === 2
                    ? "bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow"
                    : rank === 3
                    ? "bg-gradient-to-br from-slate-400 to-slate-500 text-white shadow"
                    : "bg-slate-100 text-slate-600 border border-slate-200";

                return (
                  <tr
                    key={row.city}
                    className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                      rank === 1 ? "bg-indigo-50/40" : ""
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
                        className={`font-semibold text-slate-900 hover:text-indigo-700 transition-colors ${
                          rank === 1 ? "text-base" : "text-sm"
                        }`}
                      >
                        {row.city}
                      </Link>
                    </td>
                    <td className={`py-3 px-4 text-center font-bold ${
                      isTrendRanking ? (row.value >= 0 ? "text-emerald-700" : "text-red-600") : a.value
                    } ${rank === 1 ? "text-lg" : ""}`}>
                      {/* the year/range stacks UNDER the value — site-wide rule */}
                      <span className="block leading-tight">{row.formatted}</span>
                      {row.sub && (
                        <span dir="ltr" className="block whitespace-nowrap text-[9px] font-normal leading-none text-slate-400 tabular-nums">{row.sub}</span>
                      )}
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
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.keys(RANKING_CONFIG) as RankingType[])
            .filter((t) => t !== type)
            .map((t) => {
              const o = RANKING_CONFIG[t];
              const oa = accentClasses[o.accent];
              return (
                <Link
                  key={t}
                  href={`/rankings/${t}`}
                  className="glass-card p-3 flex items-center gap-2 hover:border-indigo-300 transition-all group"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${oa.icon}`}>
                    <Icon name={o.icon} size="1em" />
                  </div>
                  <span className="text-xs font-semibold text-slate-900 group-hover:text-indigo-700 transition-colors leading-tight">
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
