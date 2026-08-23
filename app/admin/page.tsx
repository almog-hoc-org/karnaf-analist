import { prisma } from "@/lib/db";
import { withBasePath } from "@/lib/basePath";
import { redirect } from "next/navigation";
import { isAdminRequest } from "@/lib/adminAuth";
import AdminDealsBrowser from "@/components/AdminDealsBrowser";
import AdminRulesPanel from "@/components/AdminRulesPanel";
import AdminTablesBrowser from "@/components/AdminTablesBrowser";
import AdminTabs from "@/components/AdminTabs";
import AdminSectionOrderPanel from "@/components/AdminSectionOrderPanel";
import AdminReliabilityPanel, { type ReliabilityReport, type AnomalyVerification, type CleaningVerification } from "@/components/AdminReliabilityPanel";
import AdminLogicPanel from "@/components/AdminLogicPanel";
import AdminUsersPanel, { type AdminUserStats, type AdminFeedbackRow } from "@/components/AdminUsersPanel";
import AdminUsagePanel from "@/components/AdminUsagePanel";
import { appDb } from "@/lib/appDb";
import { ravMesserConfigured, crmConfigured } from "@/lib/mailingSync";
import { ensureFeedbackTable } from "@/lib/feedback";
import { listUsers, type AdminUserRow } from "@/lib/userAdmin";
import { broadcastConfigured, broadcastHistory, type BroadcastRow } from "@/lib/broadcast";

function loadUserList(): AdminUserRow[] {
  try { return listUsers(); } catch { return []; }
}
function loadBroadcastHistory(): BroadcastRow[] {
  try { return broadcastHistory(); } catch { return []; }
}
import fs from "fs";
import path from "path";

/** User/mailing/feedback numbers for the users tab — all cheap COUNTs on app.db. */
function loadUserStats(): AdminUserStats {
  const empty: AdminUserStats = { total: 0, consenting: 0, withPhone: 0, unsyncedRavmesser: 0, unsyncedCrm: 0, creditsInCirculation: 0 };
  try {
    const one = (sql: string) => (appDb().prepare(sql).get() as { n: number } | undefined)?.n ?? 0;
    return {
      total: one("SELECT COUNT(*) n FROM users"),
      consenting: one("SELECT COUNT(*) n FROM users WHERE mailing_consent=1"),
      withPhone: one("SELECT COUNT(*) n FROM users WHERE phone IS NOT NULL AND phone != ''"),
      unsyncedRavmesser: one("SELECT COUNT(*) n FROM users WHERE mailing_consent=1 AND ravmesser_synced_at IS NULL"),
      unsyncedCrm: one("SELECT COUNT(*) n FROM users WHERE crm_synced_at IS NULL"),
      creditsInCirculation: Math.round(one("SELECT COALESCE(SUM(delta_tenths),0) n FROM credits_ledger") / 10),
    };
  } catch { return empty; } // tables appear with the first signup — an empty tab beats a crash
}

function loadRecentFeedback(): AdminFeedbackRow[] {
  try {
    ensureFeedbackTable();
    const rows = appDb().prepare(
      `SELECT id, kind, message, city, email, user_id, approved_at, created_at
         FROM feedback ORDER BY (approved_at IS NULL) DESC, id DESC LIMIT 40`
    ).all() as Array<{ id: number; kind: string; message: string; city: string | null; email: string | null; user_id: number | null; approved_at: string | null; created_at: string }>;
    return rows.map((r) => ({
      id: r.id, kind: r.kind, message: r.message, city: r.city, email: r.email,
      hasUser: r.user_id != null, approved: r.approved_at != null, created_at: r.created_at,
    }));
  } catch { return []; }
}

import { cacheStats } from "@/lib/dealsCache";

/** Sources that can only refresh from the operator's Israeli machine (geo-block / reCAPTCHA). */
const QUARTERLY_SOURCES = new Set(["govmap", "prefetch-deals", "nadlan"]);

interface SourceFreshnessRow { source: string; lastStatus: string; lastAt: string; lastOkAt: string | null }

/**
 * Per-source freshness: latest attempt + latest SUCCESS. The aggregate run
 * status hides exactly this — a source can be skipped nightly for months while
 * the run stays green.
 */
function loadSourceFreshness(): SourceFreshnessRow[] {
  try {
    return appDb().prepare(
      `SELECT s.source,
              s.status AS lastStatus,
              s.started_at AS lastAt,
              (SELECT MAX(o.started_at) FROM collection_source_runs o
                WHERE o.source = s.source AND o.status = 'ok') AS lastOkAt
         FROM collection_source_runs s
        WHERE s.id IN (SELECT MAX(id) FROM collection_source_runs GROUP BY source)
        ORDER BY s.source`
    ).all() as SourceFreshnessRow[];
  } catch { return []; }
}

function loadReliabilityReport(): ReliabilityReport | null {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "data-reliability.json"), "utf8")); }
  catch { return null; }
}
function loadAnomalyVerification(): AnomalyVerification | null {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "anomaly-verification.json"), "utf8")); }
  catch { return null; }
}
function loadCleaningVerification(): CleaningVerification | null {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "cleaning-verification.json"), "utf8")); }
  catch { return null; }
}

export const metadata = { title: "ניהול דאטה | קרנף אנליסט" };
export const dynamic = "force-dynamic";


/** Timestamps arrive in several shapes (ISO, SQLite datetime, JS Date string).
 *  Parse first, format once — slicing raw strings produced "ul 23 2026". */
function when(v: unknown): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "—";
  let d = new Date(raw);
  if (Number.isNaN(d.getTime())) d = new Date(raw.replace(" ", "T")); // SQLite "YYYY-MM-DD HH:MM:SS"
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function AdminPage() {
  if (!isAdminRequest()) redirect("/admin/login");

  // Everything is scoped to the last 10 years — the window the whole site uses —
  // and the count decomposes exactly: total = active + excluded(by reason).
  const [kpi] = await prisma.$queryRawUnsafe<Array<Record<string, bigint | string | null>>>(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN COALESCE(excluded,0)=0 THEN 1 ELSE 0 END) active,
            SUM(CASE WHEN COALESCE(excluded,0)=0 AND source='nadlan' THEN 1 ELSE 0 END) nadlan,
            SUM(CASE WHEN COALESCE(excluded,0)=0 AND year_built IS NOT NULL THEN 1 ELSE 0 END) classified,
            SUM(CASE WHEN COALESCE(excluded,0)=0 AND is_secondhand=1 THEN 1 ELSE 0 END) sh,
            SUM(CASE WHEN COALESCE(excluded,0)=0 AND street IS NOT NULL THEN 1 ELSE 0 END) with_street,
            SUM(CASE WHEN exclusion_reason LIKE 'מוזג%' THEN 1 ELSE 0 END) exc_merged,
            SUM(CASE WHEN exclusion_reason LIKE 'אנומליית מחיר%' THEN 1 ELSE 0 END) exc_anomaly,
            SUM(CASE WHEN exclusion_reason LIKE 'סינון-שפיות%' THEN 1 ELSE 0 END) exc_unusable,
            SUM(CASE WHEN exclusion_reason LIKE 'כפילות-דיווח%' THEN 1 ELSE 0 END) exc_dupe,
            SUM(CASE WHEN COALESCE(excluded,0)=0 AND COALESCE(luxury,0)=1 THEN 1 ELSE 0 END) luxury,
            SUM(CASE WHEN COALESCE(excluded,0)=1 THEN 1 ELSE 0 END) excluded,
            COUNT(DISTINCT city_name) cities,
            MAX(deal_date) maxd
     FROM nadlan_transactions
     WHERE deal_year >= CAST(strftime('%Y','now') AS INTEGER) - 10`
  );
  const cities = await prisma.city.findMany({ select: { city_name: true }, orderBy: { population_2026: "desc" } });
  const runs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT city_name, source, status, n_deals, method_version, last_collected
     FROM nadlan_collection_status ORDER BY last_collected DESC LIMIT 10`
  ).catch(() => []);
  const exclusionLog = await prisma.$queryRawUnsafe<any[]>(
    `SELECT action, affected, reason, created_at FROM admin_exclusion_log ORDER BY id DESC LIMIT 8`
  ).catch(() => []);

  let coverage: { completeCities?: number; totalCities?: number; generatedAt?: string } = {};
  try {
    coverage = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "coverage-gaps.json"), "utf8"));
  } catch { /* not generated yet */ }

  const freshness = { sources: loadSourceFreshness(), cache: cacheStats() };

  const N = (v: unknown) => Number(v ?? 0);
  const active = N(kpi?.active);
  const tiles: Array<[string, string]> = [
    ["עסקאות שמישות (10ש')", active.toLocaleString("he-IL")],
    ["מתוכן ערוץ nadlan", N(kpi?.nadlan).toLocaleString("he-IL")],
    ["עם שנת בנייה", `${Math.round((N(kpi?.classified) / Math.max(1, active)) * 100)}%`],
    ["יד שנייה", N(kpi?.sh).toLocaleString("he-IL")],
    ["עם כתובת רחוב", `${Math.round((N(kpi?.with_street) / Math.max(1, active)) * 100)}%`],
    ["מוחרגות", N(kpi?.excluded).toLocaleString("he-IL")],
    ["כפילויות דיווח", N(kpi?.exc_dupe).toLocaleString("he-IL")],
    // luxury is NOT subtracted from `active` — the deal happened, it just doesn't set a price
    ["יוקרה (מחוץ למחירים)", N(kpi?.luxury).toLocaleString("he-IL")],
    ["ערים", N(kpi?.cities).toLocaleString("he-IL")],
    ["כיסוי 10 שנים", coverage.completeCities != null ? `${coverage.completeCities}/${coverage.totalCities}` : "—"],
  ];
  // Reconciliation strip — the count decomposes exactly, no more "mismatch".
  const recon = `סה"כ ${N(kpi?.total).toLocaleString("he-IL")} = שמישות ${active.toLocaleString("he-IL")} + מוחרגות ${N(kpi?.excluded).toLocaleString("he-IL")} ` +
    `(מוזג ${N(kpi?.exc_merged).toLocaleString("he-IL")} · כפילות-דיווח ${N(kpi?.exc_dupe).toLocaleString("he-IL")} · אנומליית מחיר ${N(kpi?.exc_anomaly).toLocaleString("he-IL")} · שפיות ${N(kpi?.exc_unusable).toLocaleString("he-IL")}) ` +
    `· מתוך השמישות ${N(kpi?.luxury).toLocaleString("he-IL")} עסקאות יוקרה — נספרות ומוצגות, אך אינן נכנסות לממוצעים`;

  return (
    <main className="min-h-screen page-wrap-wide py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black"><span className="text-gradient-hero">🛠️ ניהול דאטה</span></h1>
          <p className="mt-1 text-xs text-slate-500">
            המאגר העצמאי · עדכון אחרון {String(kpi?.maxd ?? "—").slice(0, 10)} · <a href={withBasePath("/methodology")} className="font-bold text-indigo-700 hover:underline">מתודולוגיה מלאה ←</a>
          </p>
        </div>
      </header>

      <AdminTabs
        reliability={<AdminReliabilityPanel report={loadReliabilityReport()} anomaly={loadAnomalyVerification()} cleaning={loadCleaningVerification()} />}
        logic={<AdminLogicPanel />}
        rules={<AdminRulesPanel />}
        layout={<AdminSectionOrderPanel />}
        deals={<AdminDealsBrowser cities={cities.map((c) => c.city_name)} />}
        tables={<AdminTablesBrowser />}
        users={<AdminUsersPanel
          stats={loadUserStats()}
          feedback={loadRecentFeedback()}
          ravConfigured={ravMesserConfigured()}
          crmConfigured={crmConfigured()}
          users={loadUserList()}
          broadcastConfigured={broadcastConfigured()}
          broadcastHistory={loadBroadcastHistory()}
        />}
        usage={<AdminUsagePanel />}
        overview={<>
      {/* Reconciliation strip — total = active + excluded(by reason), no mismatch */}
      <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-2 text-center text-xs font-bold text-slate-700" dir="rtl">
        {recon}
      </div>
      {/* KPIs */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {tiles.map(([label, value]) => (
          <div key={label} className="kpi-card glow-indigo !p-3">
            <div className="stat-label">{label}</div>
            <div className="mt-1 text-xl font-black tabular-nums text-slate-900">{value}</div>
          </div>
        ))}
      </section>

      {/* runs + exclusion log */}
      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass-card p-5">
          <h3 className="mb-3 text-sm font-black text-slate-900">🕒 ריצות איסוף אחרונות</h3>
          <div className="overflow-x-auto">
          <table className="w-full text-2xs" dir="rtl">
            <thead><tr className="border-b border-slate-200 text-2xs font-bold text-slate-400">
              <th className="py-1 text-right">עיר</th><th>ערוץ</th><th>גרסה</th><th>עסקאות</th><th>מתי</th></tr></thead>
            <tbody>{runs.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1.5 text-right font-semibold">{r.city_name}</td>
                <td className="text-center">{r.source}</td>
                <td className="text-center text-slate-500">{r.method_version}</td>
                <td className="text-center tabular-nums">{Number(r.n_deals ?? 0).toLocaleString("he-IL")}</td>
                <td className="text-center tabular-nums text-slate-500">{when(r.last_collected)}</td>
              </tr>))}</tbody>
          </table>
          </div>
          <p className="mt-2 text-2xs text-slate-400">איסוף מקורות פתוחים — לילי אוטומטי 02:30 · עסקאות govmap/nadlan — רענון רבעוני מהמק (חסימה גיאוגרפית מהשרת)</p>
        </div>
        <div className="glass-card p-5">
          <h3 className="mb-3 text-sm font-black text-slate-900">📋 יומן החרגות</h3>
          {exclusionLog.length === 0 ? (
            <p className="text-xs text-slate-400">אין החרגות עדיין — סמן עסקאות בדפדפן למעלה כדי להוציא אותן מהחישובים</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-2xs" dir="rtl">
              <thead><tr className="border-b border-slate-200 text-2xs font-bold text-slate-400">
                <th className="py-1 text-right">פעולה</th><th>עסקאות</th><th>סיבה</th><th>מתי</th></tr></thead>
              <tbody>{exclusionLog.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 text-right">{l.action === "exclude" ? "🚫 החרגה" : "↩️ ביטול"}</td>
                  <td className="text-center tabular-nums">{Number(l.affected).toLocaleString("he-IL")}</td>
                  <td className="text-center text-slate-600">{l.reason ?? "—"}</td>
                  <td className="text-center tabular-nums text-slate-500">{when(l.created_at)}</td>
                </tr>))}</tbody>
            </table>
            </div>
          )}
        </div>
      </section>

      {/* Per-source freshness — the honest answer to "when did each source
          actually succeed", which the aggregate run status hides. */}
      <section className="mt-6">
        <div className="glass-card p-5">
          <h3 className="mb-1 text-sm font-black text-slate-900">🛰️ טריות מקורות</h3>
          <p className="mb-3 text-2xs text-slate-400">
            עסקאות אחרונות במאגר: <b className="text-slate-600">{String(kpi?.maxd ?? "—").slice(0, 10)}</b>
            {" · "}מטמון השוואת רחובות: <b className="text-slate-600">{freshness.cache.files}</b> ערים
            {freshness.cache.newestAt ? <>, עודכן {when(freshness.cache.newestAt)}</> : null}
          </p>
          {freshness.sources.length === 0 ? (
            <p className="text-xs text-slate-400">אין עדיין ריצות איסוף רשומות במכונה הזו</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-2xs" dir="rtl">
              <thead><tr className="border-b border-slate-200 text-2xs font-bold text-slate-400">
                <th className="py-1 text-right">מקור</th><th>ניסיון אחרון</th><th>הצלחה אחרונה</th><th className="text-right">מסלול העדכון</th></tr></thead>
              <tbody>{freshness.sources.map((s) => {
                const quarterly = QUARTERLY_SOURCES.has(s.source);
                const skippedAsExpected = quarterly && s.lastStatus.startsWith("skipped");
                const statusLabel =
                  s.lastStatus === "ok" ? "✓ הצליח" :
                  s.lastStatus === "failed" ? "✗ נכשל" :
                  skippedAsExpected ? "○ מדולג (צפוי)" :
                  `○ ${s.lastStatus}`;
                return (
                  <tr key={s.source} className="border-b border-slate-100">
                    <td className="py-1.5 text-right font-semibold">{s.source}</td>
                    <td className={`text-center ${s.lastStatus === "failed" ? "font-bold text-red-600" : s.lastStatus === "ok" ? "text-emerald-700" : "text-slate-500"}`}>
                      {statusLabel} · {when(s.lastAt)}
                    </td>
                    <td className="text-center tabular-nums text-slate-600">{s.lastOkAt ? when(s.lastOkAt) : "—"}</td>
                    <td className="text-right text-slate-500">{quarterly ? "רבעוני מהמק — דילוג בשרת תקין" : "לילי אוטומטי בשרת"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            </div>
          )}
          <p className="mt-2 text-2xs text-slate-400">
            מקור רבעוני שחלפו יותר מ-130 יום מהעסקה האחרונה שלו יסומן כאזהרה ב-<code>/api/status</code> — זה הסימן להריץ רענון מהמק.
          </p>
        </div>
      </section>
        </>}
      />
    </main>
  );
}
