import { prisma } from "@/lib/db";
import SortableTable, { type Yad2Row } from "./SortableTable";
import Icon from "@/components/Icon";

export const metadata = { title: 'יד2 — נתוני מצב שוק לפי עיר | קרנף אנליסט' };

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("he-IL");
}

export default async function Yad2DetailPage() {
  const rows = await prisma.yad2_market_data.findMany({
    orderBy: [{ buyers_count: "desc" }],
  });

  const tableRows: Yad2Row[] = rows.map((r) => ({
    city_name: r.city_name,
    market_type: r.market_type,
    new_properties: r.new_properties,
    new_properties_yoy: r.new_properties_yoy,
    secondhand_properties: r.secondhand_properties,
    secondhand_yoy: r.secondhand_yoy,
    avg_days_on_market: r.avg_days_on_market,
    days_yoy: r.days_yoy,
    buyers_count: r.buyers_count,
    buyers_yoy: r.buyers_yoy,
    households: r.households,
    avg_household_size: r.avg_household_size,
  }));

  const lastScraped = rows[0]?.scraped_at;

  // Aggregate stats
  const totals = rows.reduce(
    (acc, r) => ({
      new: acc.new + (r.new_properties ?? 0),
      sh:  acc.sh  + (r.secondhand_properties ?? 0),
      buyers: acc.buyers + (r.buyers_count ?? 0),
      days: acc.days + (r.avg_days_on_market ?? 0),
      cnt: acc.cnt + (r.avg_days_on_market ? 1 : 0),
    }),
    { new: 0, sh: 0, buyers: 0, days: 0, cnt: 0 }
  );
  const avgDays = totals.cnt > 0 ? totals.days / totals.cnt : null;

  const sellersCount = rows.filter((r) => r.market_type === "sellers").length;
  const buyersCount = rows.filter((r) => r.market_type === "buyers").length;
  const balancedCount = rows.filter((r) => r.market_type === "balanced").length;

  return (
    <main className="min-h-screen page-wrap-wide py-8">
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 bg-indigo-50 text-indigo-700">
            <Icon name="building" size="1em" />
          </div>
          <div className="flex-1">
            <p className="text-2xs font-bold uppercase tracking-wider mb-1 text-indigo-700">יד2</p>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-tight">
              נתוני מצב שוק — לפי עיר
            </h1>
            <p className="text-slate-600 text-base mt-1">
              מודעות חדשות, יד שנייה, ימים בשוק, קונים פעילים וסיווג שוק (קונים/מוכרים) לפי יד2
            </p>
            <div className="flex flex-wrap gap-3 mt-3 text-sm">
              <span className="px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-700 tabular-nums shadow-sm">
                <span className="font-bold text-indigo-700">{rows.length}</span>
                <span className="text-slate-500 mr-1.5">ערים</span>
              </span>
              {lastScraped && (
                <span className="px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-500 text-xs">
                  נסרק: {lastScraped.toLocaleDateString("he-IL")}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Aggregate stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <div className="kpi-card glow-indigo">
          <div className="stat-label">סה"כ מודעות חדשות</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmt(totals.new)}</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">סה"כ יד שנייה</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmt(totals.sh)}</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">סה"כ קונים פעילים</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{fmt(totals.buyers)}</div>
        </div>
        <div className="kpi-card glow-indigo">
          <div className="stat-label">ממוצע ימים בשוק</div>
          <div className="stat-large text-slate-900 mt-2 tabular-nums">{avgDays ? Math.round(avgDays) : "—"}</div>
        </div>
      </section>

      {/* Market type breakdown */}
      <section className="mb-6 glass-card p-4">
        <h3 className="text-sm font-bold text-slate-900 mb-3">סיווג שוק לפי עיר</h3>
        <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
          <div className="p-3 rounded-xl bg-red-50 border border-red-200">
            <div className="text-2xl font-extrabold text-red-600 tabular-nums">{sellersCount}</div>
            <div className="text-xs text-red-600 font-semibold mt-1">שוק מוכרים</div>
            <div className="text-2xs text-slate-600 mt-0.5">היצע נמוך → מחירים עולים</div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-2xl font-extrabold text-slate-700 tabular-nums">{balancedCount}</div>
            <div className="text-xs text-slate-700 font-semibold mt-1">שוק מאוזן</div>
            <div className="text-2xs text-slate-600 mt-0.5">היצע = ביקוש</div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="text-2xl font-extrabold text-emerald-700 tabular-nums">{buyersCount}</div>
            <div className="text-xs text-emerald-700 font-semibold mt-1">שוק קונים</div>
            <div className="text-2xs text-slate-600 mt-0.5">היצע גבוה → מחירים יורדים</div>
          </div>
        </div>
      </section>

      {/* Main table */}
      <div className="glass-card overflow-hidden">
        <div className="h-1 bg-gradient-to-l from-indigo-500 to-indigo-600" />
        <div className="px-3 py-2 text-2xs text-slate-500 bg-slate-50 border-b border-slate-100">
          <Icon name="idea" size="1em" /> לחיצה על כותרת עמודה ממיינת את הטבלה. לחיצה נוספת הופכת את כיוון המיון.
        </div>
        <SortableTable initialRows={tableRows} />
      </div>

      <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <h3 className="text-xs font-bold text-slate-900 mb-2 uppercase tracking-wider"><Icon name="clipboard" size="1em" /> מקרא</h3>
        <ul className="text-xs text-slate-700 space-y-1 list-disc pr-5">
          <li><strong>מודעות חדשות</strong>: דירות חדשות בקבלן שעלו לאתר בתקופה האחרונה</li>
          <li><strong>יד שנייה</strong>: דירות יד שנייה במכירה</li>
          <li><strong>ימים בשוק (ממוצע)</strong>: כמה ימים מודעה ממוצעת חיה לפני שמתבצעת עסקה (נמוך = שוק חם)</li>
          <li><strong>קונים פעילים</strong>: משתמשי יד2 שביצעו פעולת חיפוש דירות בעיר בחודש האחרון</li>
          <li><strong>YoY</strong>: שינוי לעומת אותה תקופה לפני שנה. עבור ימים בשוק — ירידה (ירוק) משמעותה שוק חם יותר</li>
          <li><strong>סוג שוק</strong>: סיווג של יד2 לפי יחס היצע לביקוש</li>
        </ul>
      </div>

    </main>
  );
}
