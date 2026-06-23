import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";
import {
  SOURCES,
  getSourceById,
  getCategoryByKey,
  nextExpectedPublication,
  formatScheduleHe,
  type SourceColor,
  type Source,
} from "@/lib/sources";
import { getDocumentsForSource, type SourceDocument, type DocStatus } from "@/lib/source-documents";

interface PageProps {
  params: { id: string };
}

export async function generateStaticParams() {
  return SOURCES.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: PageProps) {
  const src = getSourceById(params.id);
  return { title: src ? `${src.name} | מקורות מידע` : "מקור" };
}

const accentClasses: Record<SourceColor, { bar: string; bg: string; text: string; bgSoft: string }> = {
  cyan:    { bar: "from-cyan-500 to-cyan-600",       bg: "bg-cyan-100",    text: "text-cyan-700",    bgSoft: "bg-cyan-50" },
  emerald: { bar: "from-emerald-500 to-emerald-600", bg: "bg-emerald-100", text: "text-emerald-700", bgSoft: "bg-emerald-50" },
  amber:   { bar: "from-amber-500 to-amber-600",     bg: "bg-amber-100",   text: "text-amber-700",   bgSoft: "bg-amber-50" },
  purple:  { bar: "from-purple-500 to-purple-600",   bg: "bg-purple-100",  text: "text-purple-700",  bgSoft: "bg-purple-50" },
  rose:    { bar: "from-rose-500 to-rose-600",       bg: "bg-rose-100",    text: "text-rose-700",    bgSoft: "bg-rose-50" },
};

function formatHeDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });
}

// ── Per-source data aggregators ─────────────────────────────────────

async function fetchSourceData(src: Source): Promise<React.ReactNode> {
  switch (src.id) {
    case "cbs-national-construction":
    case "cbs-media-housing": {
      const rows = await prisma.national_construction.findMany({ orderBy: { year: "asc" } });
      return (
        <DataTable
          title="התחלות בנייה, היתרים וגמרי בנייה ארציים"
          rows={rows.map((r) => ({
            cells: [
              { v: r.year, bold: true },
              { v: r.permits, fmt: "n" },
              { v: r.starts, fmt: "n" },
              { v: r.completions, fmt: "n" },
            ],
          }))}
          headers={["שנה", "היתרים", "התחלות", "גמרי בנייה"]}
        />
      );
    }
    case "cbs-construction-by-city": {
      const rows = await prisma.cbsPressData.findMany({
        orderBy: [{ year: "desc" }, { city_name: "asc" }],
        take: 100,
      });
      return (
        <DataTable
          title="התחלות בנייה לפי עיר (מתוך CBS Press Data)"
          rows={rows.map((r) => ({
            cells: [
              { v: r.year, bold: true },
              { v: r.city_name, link: `/city/${encodeURIComponent(r.city_name)}` },
              { v: r.construction_starts, fmt: "n" },
            ],
          }))}
          headers={["שנה", "עיר", "התחלות"]}
          truncationNote={rows.length === 100 ? `מציג 100 רשומות אחרונות מתוך 243 בסה"כ` : undefined}
        />
      );
    }
    case "cbs-census-2022":
    case "cbs-localities-2023": {
      const year = src.id === "cbs-census-2022" ? 2022 : 2023;
      const rows = await prisma.population_by_year.findMany({
        where: { year },
        orderBy: { population: "desc" },
        take: 100,
      });
      return (
        <DataTable
          title={`אוכלוסייה לפי יישוב (${year})`}
          rows={rows.map((r) => ({
            cells: [
              { v: r.city_name, link: `/city/${encodeURIComponent(r.city_name)}` },
              { v: r.population, fmt: "n" },
            ],
          }))}
          headers={["עיר", "אוכלוסייה"]}
          truncationNote="מציג 100 הערים הגדולות"
        />
      );
    }
    case "cbs-population-2026": {
      const rows = await prisma.city.findMany({
        where: { population_2026: { not: null } },
        orderBy: { population_2026: "desc" },
        take: 100,
        select: { city_name: true, population_2026: true, population_growth_pct: true },
      });
      return (
        <DataTable
          title="תחזית אוכלוסייה 2026 לפי עיר"
          rows={rows.map((r) => ({
            cells: [
              { v: r.city_name, link: `/city/${encodeURIComponent(r.city_name)}` },
              { v: r.population_2026, fmt: "n" },
              { v: r.population_growth_pct ? `${r.population_growth_pct >= 0 ? "+" : ""}${r.population_growth_pct.toFixed(1)}%` : "—" },
            ],
          }))}
          headers={["עיר", "תחזית 2026", "צמיחה מ-2021"]}
          truncationNote="מציג 100 הערים הגדולות"
        />
      );
    }
    case "cbs-construction-cost-index": {
      // Surface the dedicated stat page link first
      return (
        <div className="space-y-4">
          <Link href="/stats/construction-cost-index" className="block glass-card p-5 hover:border-amber-300 transition-all group">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">📊 דוח אינטראקטיבי במערכת</div>
                <div className="text-lg font-bold text-slate-900 group-hover:text-amber-700 transition-colors">מדד מחירי תשומה בבנייה — 10 שנים</div>
                <div className="text-xs text-slate-600 mt-1">11 שנים של ערכים שנתיים, שינוי YoY, רמת מהימנות לכל נקודה</div>
              </div>
              <span className="text-2xl text-amber-700 group-hover:translate-x-[-4px] transition-transform">←</span>
            </div>
          </Link>
        </div>
      );
    }
    case "cbs-housing-price-index":
    case "cbs-price-change-monthly":
    case "cbs-avg-prices-housing":
    case "cbs-transactions-apartments": {
      // Show what we extracted from this source via scattered facts + nadlan trends.
      // Surface the national HPI stat page if relevant.
      const showNationalHpi = src.id === "cbs-housing-price-index" || src.id === "cbs-price-change-monthly";
      const matchKeywords: Record<string, string[]> = {
        "cbs-housing-price-index": ["מדד מחירי דירות", "Housing Price Index"],
        "cbs-price-change-monthly": ["שינוי במחירי", "monthly", "YoY"],
        "cbs-avg-prices-housing": ["מחירים ממוצעים", "average price", "מחיר ממוצע"],
        "cbs-transactions-apartments": ["דירות בעסקאות", "transactions", "עסקאות"],
        "cbs-construction-cost-index": ["תשומה בבנייה", "construction cost", "מלט", "תשומה"],
      };
      const facts = loadScatteredFacts().filter((f) => {
        const keywords = matchKeywords[src.id] ?? [];
        const hay = `${f.source_name} ${f.fact}`.toLowerCase();
        return keywords.some((k) => hay.includes(k.toLowerCase()));
      });
      const rows = await prisma.nadlan_price_trends.findMany({
        where: { median_price: { not: null } },
        orderBy: [{ year: "desc" }, { quarter: "desc" }, { median_price: "desc" }],
        take: 60,
      });
      return (
        <>
          {showNationalHpi && (
            <Link href="/stats/national-hpi" className="block glass-card p-5 mb-5 hover:border-cyan-300 transition-all group">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-cyan-700 uppercase tracking-wider mb-1">📊 דוח אינטראקטיבי במערכת</div>
                  <div className="text-lg font-bold text-slate-900 group-hover:text-cyan-700 transition-colors">מדד מחירי דירות לאומי — שינויים שנתיים וחודשיים</div>
                </div>
                <span className="text-2xl text-cyan-700 group-hover:translate-x-[-4px] transition-transform">←</span>
              </div>
            </Link>
          )}
          {facts.length > 0 && (
            <div className="mb-5">
              <FactsList title={`ממצאים מהמקור (${facts.length})`} facts={facts} />
            </div>
          )}
          <DataTable
            title={`חציוני מחיר רבעוניים מ-nadlan.gov.il — לאימות צולב מול מדד למ"ס`}
            rows={rows.map((r) => ({
              cells: [
                { v: `${r.year} Q${r.quarter}`, bold: true },
                { v: r.city_name, link: `/city/${encodeURIComponent(r.city_name)}` },
                { v: r.median_price ? `₪${r.median_price.toLocaleString("he-IL")}` : "—" },
              ],
            }))}
            headers={["תקופה", "עיר", "חציון מחיר"]}
            truncationNote={`מציג 60 רשומות אחרונות מתוך 1,879 בסה"כ`}
          />
        </>
      );
    }
    case "mof-housing-review-monthly":
    case "mof-chief-economist-publications": {
      const facts = loadScatteredFacts().filter((f) =>
        f.source_name?.includes("הכלכלן הראשי") ||
        f.source_name?.toLowerCase().includes("mof") ||
        f.source_name?.includes("האוצר")
      );
      if (facts.length === 0) return <EmptyNote text="טרם נאספו נתונים מהמקור הזה — צפוי בסקירה הבאה" />;
      return (
        <FactsList
          title="ממצאים מסקירות הכלכלן הראשי"
          facts={facts}
        />
      );
    }
    case "nadlan-deals": {
      const rows = await prisma.nadlan_price_trends.findMany({
        where: { median_price: { not: null }, quarter: 1, year: 2025 },
        orderBy: { median_price: "desc" },
        take: 100,
        select: { city_name: true, median_price: true, source: true },
      });
      return (
        <DataTable
          title="חציון מחיר Q1 2025 לפי עיר"
          rows={rows.map((r) => ({
            cells: [
              { v: r.city_name, link: `/city/${encodeURIComponent(r.city_name)}` },
              { v: r.median_price ? `₪${r.median_price.toLocaleString("he-IL")}` : "—" },
              { v: r.source || "nadlan.gov.il" },
            ],
          }))}
          headers={["עיר", "חציון מחיר", "מקור רשומה"]}
        />
      );
    }
    case "govmap-api": {
      const cacheDir = path.resolve(process.cwd(), "data", "deals_cache");
      let cached = 0;
      let withData = 0;
      let totalDeals = 0;
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
        cached = files.length;
        for (const f of files) {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf-8"));
            if (d.neighborhoods?.length > 0) withData++;
            totalDeals += d.totalDealsAnalyzed || 0;
          } catch {}
        }
      }
      return (
        <StatsGrid
          stats={[
            { label: "ערים במאגר", value: cached.toString() },
            { label: "ערים עם עסקאות", value: withData.toString() },
            { label: `סה"כ עסקאות שנותחו`, value: totalDeals.toLocaleString("he-IL") },
          ]}
          note="מאגר מקומי המתעדכן ע״י הסקריפט lib/prefetch-deals.ts. כל עיר נשמרת כקובץ JSON נפרד."
        />
      );
    }
    case "yad2-data": {
      const count = await prisma.yad2_market_data.count();
      return (
        <div className="space-y-4">
          <Link
            href="/stats/yad2-market-data"
            className="block glass-card p-5 hover:border-amber-300 transition-all group"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">
                  📊 דוח אינטראקטיבי במערכת
                </div>
                <div className="text-lg font-bold text-slate-900 group-hover:text-amber-700 transition-colors">
                  טבלת מצב שוק יד2 — כל הערים
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {count} ערים עם נתוני מודעות, ימים בשוק, קונים פעילים, וסיווג שוק
                </div>
              </div>
              <span className="text-2xl text-amber-700 group-hover:translate-x-[-4px] transition-transform">←</span>
            </div>
          </Link>
        </div>
      );
    }
    case "madlan":
    case "madadirot":
    case "globes":
    case "calcalist":
    case "ynet":
    case "themarker":
    case "internal-research":
    case "data-gov-il":
      return (
        <EmptyNote
          text="המקור הזה משמש לאימות צולב והשלמות אד-הוק. הנתונים שנשאבו ממנו משולבים ישירות בערים ובמדדים, ראה עמודי הערים."
        />
      );
    default:
      return <EmptyNote text="אין תצוגת נתונים מובנית למקור הזה (משמש לאימות בלבד)" />;
  }
}

// ── Render primitives ────────────────────────────────────────────

function DataTable({
  title,
  rows,
  headers,
  truncationNote,
}: {
  title: string;
  rows: { cells: Array<{ v: number | string | null; bold?: boolean; fmt?: "n"; link?: string }> }[];
  headers: string[];
  truncationNote?: string;
}) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{rows.length} רשומות</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums" dir="rtl">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              {headers.map((h) => (
                <th key={h} className="py-2.5 px-3 text-right text-xs text-slate-500 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                {row.cells.map((c, j) => {
                  let display: React.ReactNode = "—";
                  if (c.v !== null && c.v !== undefined && c.v !== "") {
                    if (c.fmt === "n" && typeof c.v === "number") display = c.v.toLocaleString("he-IL");
                    else display = String(c.v);
                  }
                  const inner = c.link ? (
                    <Link href={c.link} className="text-cyan-700 hover:text-cyan-900 hover:underline">
                      {display}
                    </Link>
                  ) : (
                    display
                  );
                  return (
                    <td key={j} className={`py-2 px-3 text-right ${c.bold ? "font-bold text-slate-900" : "text-slate-700"}`}>
                      {inner}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncationNote && (
        <p className="px-5 py-2 text-[11px] text-slate-500 bg-slate-50/50 border-t border-slate-100">{truncationNote}</p>
      )}
    </div>
  );
}

function StatsGrid({ stats, note }: { stats: { label: string; value: string }[]; note?: string }) {
  return (
    <div className="glass-card p-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="text-center p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-3xl font-extrabold text-slate-900 tabular-nums">{s.value}</div>
            <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">{s.label}</div>
          </div>
        ))}
      </div>
      {note && <p className="text-xs text-slate-500 mt-4 text-center">{note}</p>}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="glass-card p-8 text-center">
      <p className="text-sm text-slate-600">{text}</p>
    </div>
  );
}

interface ScatteredFact {
  city: string;
  category: string;
  fact: string;
  source_url: string;
  source_name: string;
  published: string;
  confidence?: string;
}

function loadScatteredFacts(): ScatteredFact[] {
  try {
    const fp = path.resolve(process.cwd(), "data", "scattered_city_facts.json");
    if (!fs.existsSync(fp)) return [];
    const j = JSON.parse(fs.readFileSync(fp, "utf-8"));
    return j.facts || [];
  } catch {
    return [];
  }
}

function FactsList({ title, facts }: { title: string; facts: ScatteredFact[] }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{facts.length} ממצאים</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {facts.map((f, i) => (
          <li key={i} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3 mb-1">
              <Link href={`/city/${encodeURIComponent(f.city)}`} className="text-xs font-bold text-cyan-700 hover:underline">
                {f.city}
              </Link>
              <span className="text-[10px] text-slate-400">{formatHeDate(f.published)}</span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{f.fact}</p>
            <a href={f.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-500 hover:text-cyan-700 mt-1 inline-block">
              {f.source_name} ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Documents list per source ────────────────────────────────────

function StatusBadge({ status }: { status: DocStatus }) {
  const map: Record<DocStatus, { he: string; cls: string; icon: string }> = {
    extracted:  { he: "נשאב",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "✓" },
    referenced: { he: "צוטט",     cls: "bg-amber-50 text-amber-700 border-amber-200",       icon: "↗" },
    indexed:    { he: "במעקב",    cls: "bg-slate-50 text-slate-600 border-slate-200",       icon: "•" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${m.cls} whitespace-nowrap`}>
      <span aria-hidden>{m.icon}</span>
      <span>{m.he}</span>
    </span>
  );
}

function DocumentsList({ docs }: { docs: SourceDocument[] }) {
  if (docs.length === 0) return null;
  // Group by year, newest first
  const byYear = new Map<number, SourceDocument[]>();
  for (const d of docs) {
    if (!byYear.has(d.year)) byYear.set(d.year, []);
    byYear.get(d.year)!.push(d);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b - a);
  const extractedCount = docs.filter((d) => d.status === "extracted").length;
  const referencedCount = docs.filter((d) => d.status === "referenced").length;
  const indexedCount = docs.filter((d) => d.status === "indexed").length;
  return (
    <section className="glass-card overflow-hidden mb-6">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">📑 מסמכים ופרסומים ספציפיים</h3>
          <p className="text-xs text-slate-500 mt-0.5">{docs.length} מסמכים בסה"כ</p>
        </div>
        <div className="flex gap-1.5 text-[10px]">
          <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
            <strong>{extractedCount}</strong> נשאב
          </span>
          <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
            <strong>{referencedCount}</strong> צוטט
          </span>
          <span className="px-2 py-1 rounded bg-slate-50 text-slate-600 border border-slate-200 font-semibold">
            <strong>{indexedCount}</strong> במעקב
          </span>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {years.map((year) => (
          <div key={year} className="px-5 py-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base font-extrabold text-slate-900 tabular-nums">{year}</span>
              <span className="text-[10px] text-slate-400">({byYear.get(year)!.length} מסמכים)</span>
            </div>
            <ul className="space-y-2">
              {byYear.get(year)!.map((d, i) => (
                <li key={i} className="flex items-start gap-2">
                  <StatusBadge status={d.status} />
                  <div className="flex-1 min-w-0">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-slate-800 hover:text-cyan-700 hover:underline break-words"
                    >
                      {d.name}
                    </a>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 mt-0.5">
                      <span>📅 {d.date}</span>
                      {d.publicationNumber && (
                        <span className="font-mono">פרסום: {d.publicationNumber}</span>
                      )}
                      {d.notes && <span className="text-slate-600">— {d.notes}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="px-5 py-2 text-[10px] text-slate-500 bg-slate-50 border-t border-slate-100">
        💡 <strong>נשאב</strong> — חולצו ממנו נתונים שמשמשים את האתר.{" "}
        <strong>צוטט</strong> — כיסוי עיתונאי שמסתמך על הפרסום.{" "}
        <strong>במעקב</strong> — הפרסום נרשם בלוח הפרסומים אבל טרם נשאבו ממנו נתונים.
      </div>
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────

export default async function SourceDetailPage({ params }: PageProps) {
  const src = getSourceById(params.id);
  if (!src) notFound();

  const cat = getCategoryByKey(src.category);
  const a = accentClasses[cat?.color ?? "cyan"];
  const next = nextExpectedPublication(src);
  const dataView = await fetchSourceData(src);
  const isOverdue = next && next < new Date();
  const documents = getDocumentsForSource(src.id);

  return (
    <main className="min-h-screen px-4 py-8 max-w-5xl mx-auto">
      <nav className="flex items-center justify-between mb-6">
        <Link href="/sources" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-cyan-700 transition-colors">
          <span>←</span>
          <span>חזרה לרשימת המקורות</span>
        </Link>
        <Link href="/" className="text-sm text-slate-600 hover:text-cyan-700 transition-colors">
          דף הבית ←
        </Link>
      </nav>

      <header className="mb-8">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${a.bg}`}>
            {cat?.icon || "📋"}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${a.text}`}>
              {src.organization}
            </p>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-tight">{src.name}</h1>
            <p className="text-slate-600 text-base mt-1">{src.description}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {src.url && src.url !== "#" && (
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${a.bgSoft} ${a.text} border border-current/20 hover:opacity-80 transition-opacity`}
            >
              <span>פתח באתר המקור</span>
              <span>↗</span>
            </a>
          )}
          <span className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs text-slate-700">
            קצב פרסום: <span className="font-bold">{formatScheduleHe(src.publicationSchedule)}</span>
          </span>
          {src.publicationDate && (
            <span className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs text-slate-700">
              פרסום אחרון: <span className="font-bold">{formatHeDate(src.publicationDate)}</span>
            </span>
          )}
          {next && (
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                isOverdue
                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                  : "bg-cyan-50 text-cyan-700 border border-cyan-200"
              }`}
            >
              {isOverdue ? "⏰ עיכוב — היה צפוי " : "📅 פרסום הבא צפוי "}
              {formatHeDate(next)}
            </span>
          )}
        </div>
      </header>

      {/* Linkage to DB tables */}
      {src.feedsTables && src.feedsTables.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-slate-50 border border-slate-200">
          <h3 className="text-xs font-bold text-slate-900 mb-2 uppercase tracking-wider">מזין לטבלאות במערכת</h3>
          <div className="flex flex-wrap gap-1.5">
            {src.feedsTables.map((t) => (
              <code key={t} className="px-2 py-1 rounded bg-white border border-slate-200 text-[11px] text-slate-700 font-mono">
                {t}
              </code>
            ))}
          </div>
        </div>
      )}

      {/* Specific documents used from this source */}
      <DocumentsList docs={documents} />

      {/* Data view */}
      <section>
        <h2 className="text-lg font-bold text-slate-900 mb-3">📊 ריכוז הנתונים מהמקור</h2>
        {dataView}
      </section>

      <footer className="mt-12 pt-6 border-t border-slate-200 text-center">
        <Link href="/sources" className="text-sm text-slate-600 hover:text-cyan-700 transition-colors">
          ← חזרה לרשימת המקורות
        </Link>
      </footer>
    </main>
  );
}
