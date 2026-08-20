"use client";

import { useEffect, useState } from "react";
import AdminUserUsageTable, { humanSeconds } from "@/components/AdminUserUsageTable";
import CollapsibleCard from "@/components/admin/CollapsibleCard";
import PageName from "@/components/admin/PageName";
import Icon from "@/components/Icon";
import { labelForPath, sectionLabel } from "@/lib/pageLabels";
import type {
  UsageSummary, UsagePageRow, UserUsageRow, VisitShape, VisitorShape, ExitRow, LandingRow,
  FunnelStage, DeadEndRow, CityDemandRow, CreditEconomy, CohortRow, EventSummaryRow,
  DepthRow, SectionRow, VitalRow, PathStep,
} from "@/lib/events";
import type { DailyRow } from "@/lib/usageRollup";

/**
 * Admin tab: what visitors actually do, and where the product loses them.
 *
 * WHAT THE NUMBERS ARE, stated once because every panel inherits it:
 *   · ביקור  = one browser TAB. Two tabs are two visits; tomorrow is a new one.
 *   · מבקר   = one browser, for up to 180 days (a random local id).
 * The two answer different questions and neither replaces the other. 376 visits
 * from 40 visitors is a small loyal audience; 376 from 370 is a large one that
 * never comes back — and before the visitor id those were indistinguishable.
 *
 * /deals, /admin, /login and /register emit no events at all — the privacy
 * notice promises it, and lib/track.ts enforces it at the single exit point —
 * so they are absent from every table here by construction, not by filtering.
 *
 * Every card folds and remembers whether it was folded. The two that answer
 * "how is the site doing" open by default; the rest are for when a specific
 * question is being chased.
 */

const DEVICE_HE: Record<string, string> = { mobile: "📱 מובייל", tablet: "📲 טאבלט", desktop: "💻 מחשב", unknown: "לא ידוע" };

const EVENT_LABELS: Record<string, string> = {
  page_view: "צפיות בעמודים",
  page_leave: "יציאות מעמוד (מדידת זמן)",
  search: "חיפושי עיר",
  search_no_results: "חיפושים כושלים",
  search_select: "חיפושים שהסתיימו בבחירה",
  chart_action: "פעולות בגרפים",
  drill_down: "פתיחות פירוט עסקאות",
  compare_select: "בחירות בהשוואה",
  feedback_open: "פתיחות טופס משוב",
  feedback_submit: "שליחות פידבק",
  unlock_prompt_seen: "חשיפות לחומת ההרשמה",
  unlock_done: "פתיחות עיר בפועל",
  share_click: "לחיצות שיתוף",
  follow_city_click: "לחיצות מעקב עיר",
  no_result_suggestion_click: "לחיצות על הצעת חיפוש",
  session_start: "תחילות ביקור",
  cta_click: "לחיצות על כפתורי מפתח",
  rage_click: "לחיצות זעם",
  scroll_depth: "ספי גלילה (מדידה ישנה)",
  page_depth: "עומק קריאה",
  fold_view: "מסך ראשון",
  section_view: "צפיות בחלקי עמוד",
  web_vital: "מדידות מהירות",
  error_shown: "מסכי שגיאה שהוצגו",
};

const CTA_HE: Record<string, string> = {
  register: "הרשמה", login: "התחברות", check_price: "בדיקת מחיר",
  calculator: "מחשבון", course_banner: "באנר הקורס", open_deals: "סביבת עבודה",
  all_rankings: "כל הדירוג",
};

/** Google's own "good / needs work / poor" thresholds, so the colour means something. */
const VITAL_LIMITS: Record<string, { good: number; poor: number; unit: string }> = {
  LCP: { good: 2500, poor: 4000, unit: "ms" },
  INP: { good: 200, poor: 500, unit: "ms" },
  FCP: { good: 1800, poor: 3000, unit: "ms" },
  TTFB: { good: 800, poor: 1800, unit: "ms" },
  CLS: { good: 100, poor: 250, unit: "" }, // sent ×1000 — see lib/track.ts
};

interface Payload {
  days: number;
  since: string | null;
  summary: UsageSummary;
  shape: VisitShape;
  visitors: VisitorShape;
  trend: DailyRow[];
  rollup: { days: number; first: string | null; last: string | null };
  pages: UsagePageRow[];
  exits: ExitRow[];
  landings: LandingRow[];
  depth: DepthRow[];
  sections: SectionRow[];
  vitals: VitalRow[];
  paths: PathStep[];
  sources: Array<{ source: string; sessions: number }>;
  funnel: FunnelStage[];
  neverUnlocked: number;
  rage: DeadEndRow[];
  errors: Array<{ path: string; detail: string; n: number }>;
  ctas: Array<{ cta: string; n: number; sessions: number }>;
  cities: Array<CityDemandRow & { quality: "thin" | "ok" | "partial" }>;
  credits: CreditEconomy;
  cohorts: CohortRow[];
  events: EventSummaryRow[];
  misses: Array<{ term: string; n: number }>;
  searches: Array<{ term: string; n: number; misses: number }>;
  users: UserUsageRow[];
}

const RANGES = [7, 30, 90] as const;

/** Download any table as CSV. Excel opens Hebrew correctly only with the BOM. */
function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Csv({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-200 px-2 py-0.5 text-2xs font-bold text-slate-500 hover:bg-slate-50"
    >
      CSV
    </button>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-xs text-slate-400">{text}</p>;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Rows the panel has no data for yet, said honestly rather than shown as zero. */
const NOT_YET = "המדידה הזו התחילה עם הפריסה האחרונה — הנתונים מצטברים מהגולש הבא ואילך.";

export default function AdminUsagePanel() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/admin/usage?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Payload) => { if (alive) { setData(j); setState("ready"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [days]);

  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-2xs font-bold text-slate-500">טווח:</span>
      {RANGES.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setDays(d)}
          className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${
            days === d ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          {d} יום
        </button>
      ))}
    </div>
  );

  if (state === "loading") {
    return <div className="space-y-4">{picker}<p className="text-sm text-slate-400">טוען נתוני שימוש…</p></div>;
  }
  if (state === "error" || !data) {
    return (
      <div className="space-y-4">
        {picker}
        <p className="text-sm text-rose-600">לא הצלחתי לטעון את נתוני השימוש. רענן את העמוד.</p>
      </div>
    );
  }

  const { summary: sum, shape, visitors: vis } = data;
  const funnelTop = data.funnel[0]?.n ?? 0;
  const deadEnds = data.exits.filter((e) => e.exitRatePct >= 60 && e.avgSecondsBeforeExit > 0 && e.avgSecondsBeforeExit < 20 && e.views >= 5).length;
  const deviceTotal = vis.devices.reduce((a, d) => a + d.visitors, 0)
    || sum.devices.reduce((a, d) => a + d.sessions, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {picker}
        <p className="text-2xs text-slate-400">
          {data.since && <>הלוג נאסף מאז <b dir="ltr">{data.since.slice(0, 10)}</b> · </>}
          {data.rollup.days > 0 ? <>צבירה יומית: {data.rollup.days} ימים</> : <>הצבירה הלילית עוד לא רצה</>}
        </p>
      </div>

      {/* ── 1. who came ──────────────────────────────────────────────── */}
      <CollapsibleCard
        id="overview"
        defaultOpen
        title="👥 ביקורים ומבקרים"
        summary={`${vis.visitors || shape.sessions} מבקרים · ${shape.sessions} ביקורים`}
        hint="״ביקור״ הוא לשונית דפדפן; ״מבקר״ הוא דפדפן, לכל היותר 180 יום. 300 ביקורים מ-30 מבקרים הם קהל קטן ונאמן, ו-300 מ-290 הם קהל גדול שלא חוזר — לפני מזהה המבקר לא היה אפשר להבדיל ביניהם."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { v: shape.sessions.toLocaleString("he-IL"), l: `ביקורים · ${days} יום` },
            { v: (vis.visitors || 0).toLocaleString("he-IL"), l: "מבקרים יחודיים" },
            { v: `${vis.returning || 0}`, l: `חוזרים · ${vis.returningPct || 0}%` },
            { v: humanSeconds(sum.avgSessionSeconds), l: "זמן ממוצע לביקור" },
          ].map((k) => (
            <div key={k.l} className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-center">
              <p className="text-2xl font-black tabular-nums text-indigo-700">{k.v}</p>
              <p className="mt-1 text-2xs font-bold text-slate-600">{k.l}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-2xs font-black uppercase tracking-wide text-slate-500">מכשירים</p>
            {deviceTotal === 0 ? <Empty text="אין עדיין נתוני מכשיר." /> : (
              <div className="space-y-1.5">
                {(vis.devices.length ? vis.devices : sum.devices.map((d) => ({ device: d.device, visitors: d.sessions }))).map((d) => (
                  <div key={d.device} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-slate-600">{DEVICE_HE[d.device] ?? d.device}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-indigo-500" style={{ width: `${pct(d.visitors, deviceTotal)}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-left tabular-nums text-slate-500">
                      {d.visitors} · {pct(d.visitors, deviceTotal)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-2xs font-black uppercase tracking-wide text-slate-500">תדירות ביקור</p>
            {!vis.frequency.length ? <Empty text={NOT_YET} /> : (
              <ul className="space-y-1 text-xs">
                {vis.frequency.map((f) => (
                  <li key={f.bucket} className="flex justify-between gap-2">
                    <span className="text-slate-700">{f.bucket}</span>
                    <span className="tabular-nums text-slate-500">{f.visitors}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-2xs font-black uppercase tracking-wide text-slate-500">צורת הביקור</p>
            <ul className="space-y-1 text-xs">
              <li className="flex justify-between"><span className="text-slate-700">עמודים לביקור</span><span className="tabular-nums text-slate-500">{shape.pagesPerVisit.toFixed(1)}</span></li>
              <li className="flex justify-between"><span className="text-slate-700">שיעור נטישה</span><span className="tabular-nums text-slate-500">{shape.bounceRatePct}%</span></li>
              <li className="flex justify-between"><span className="text-slate-700">ביקורים של משתמש מחובר</span><span className="tabular-nums text-slate-500">{shape.signedInSessions}</span></li>
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-2xs font-black uppercase tracking-wide text-slate-500">מקור תנועה</p>
            {!data.sources.length ? <Empty text={NOT_YET} /> : (
              <ul className="space-y-1 text-xs">
                {data.sources.map((s) => (
                  <li key={s.source} className="flex justify-between gap-2">
                    <span dir="ltr" className="truncate text-slate-700">{s.source}</span>
                    <span className="tabular-nums text-slate-500">{s.sessions}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CollapsibleCard>

      {/* ── 2. the funnel ────────────────────────────────────────────── */}
      <CollapsibleCard
        id="funnel"
        defaultOpen
        title="🎯 משפך — מביקור לחשבון פעיל"
        summary={funnelTop ? `${funnelTop} ביקורי עיר → ${data.funnel[4]?.n ?? 0} פתחו עיר` : "אין תנועה בתקופה"}
        hint="כל שלב נספר מהמקור הישיר ביותר: צפיות וחשיפות מלוג האירועים, וכל מה שאחרי ההרשמה מהטבלה שרושמת את התוצאה עצמה (users, city_unlocks) — כפתור אפשר לפספס, שורה בטבלה לא. שימו לב: אלו אינם אותם אנשים ההולכים במשפך, אלא כמויות באותה תקופה."
        action={<Csv onClick={() => downloadCsv("funnel", ["שלב", "כמות", "% מהקודם"], data.funnel.map((f) => [f.label, f.n, f.ofPreviousPct]))} />}
      >
        {!funnelTop ? <Empty text="אין עדיין תנועה בתקופה." /> : (
          <div className="space-y-2">
            {data.funnel.map((f, i) => (
              <div key={f.key} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-xs text-slate-600">{f.label}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-lg bg-slate-100">
                  <div
                    className="flex h-full items-center justify-end bg-indigo-500 px-2 text-2xs font-bold text-white"
                    style={{ width: `${Math.max(pct(f.n, funnelTop), f.n ? 4 : 0)}%` }}
                  >
                    {f.n || ""}
                  </div>
                </div>
                <span className="w-16 shrink-0 text-left text-2xs tabular-nums text-slate-500">
                  {i === 0 ? "" : `${f.ofPreviousPct}%`}
                </span>
              </div>
            ))}
          </div>
        )}
        {data.neverUnlocked > 0 && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
            <Icon name="warning" size="1em" /> <b>{data.neverUnlocked}</b> חשבונות נרשמו ולא פתחו אף עיר —
            היתרה שלהם יושבת ללא שימוש. זו נקודת הכשל הכי זולה לתיקון: הם כבר נרשמו.
          </p>
        )}
      </CollapsibleCard>

      {/* ── 3. exits ─────────────────────────────────────────────────── */}
      <CollapsibleCard
        id="exits"
        title="🚪 נקודות עזיבה"
        summary={`${data.exits.length} עמודים${deadEnds ? ` · ${deadEnds} מבוי סתום` : ""}`}
        hint="שיעור יציאה גבוה אינו רע מעצמו — העמוד האחרון של ביקור מוצלח הוא גם יציאה. מה שהופך אותו לממצא הוא שיעור יציאה גבוה יחד עם זמן שהייה קצר: הגיעו, ונטשו. שתי העמודות מוצגות כדי ששני המקרים לא יתערבבו."
        action={<Csv onClick={() => downloadCsv("exits", ["עמוד", "נתיב", "צפיות", "יציאות", "% יציאה", "שניות לפני עזיבה"], data.exits.map((e) => [labelForPath(e.path).label, e.path, e.views, e.exits, e.exitRatePct, e.avgSecondsBeforeExit]))} />}
      >
        {!data.exits.length ? <Empty text="אין עדיין מספיק ביקורים." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-2xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 text-right">עמוד</th>
                  <th className="py-1 text-left">צפיות</th>
                  <th className="py-1 text-left">יציאות</th>
                  <th className="py-1 text-left">% יציאה</th>
                  <th className="py-1 text-left">זמן לפני עזיבה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.exits.map((e) => {
                  const dead = e.exitRatePct >= 60 && e.avgSecondsBeforeExit > 0 && e.avgSecondsBeforeExit < 20 && e.views >= 5;
                  return (
                    <tr key={e.path} className={dead ? "bg-rose-50/60" : ""}>
                      <td className="max-w-[300px] py-1.5 text-right">
                        <PageName path={e.path} />
                        {dead && <span className="text-2xs font-bold text-rose-600">⚠ מבוי סתום</span>}
                      </td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{e.views}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-700">{e.exits}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-700">{e.exitRatePct}%</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{humanSeconds(e.avgSecondsBeforeExit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="landings"
        title="🛬 עמודי נחיתה ונטישה"
        summary={`${data.landings.length} עמודים`}
        hint="נטישה = ביקור שראה עמוד אחד ועזב תוך פחות מ-10 שניות. עמוד שמביא תנועה שלא נשארת הוא בעיה של התאמה בין ההבטחה לתוכן."
        action={<Csv onClick={() => downloadCsv("landings", ["עמוד", "נתיב", "ביקורים", "נטישות", "% נטישה"], data.landings.map((l) => [labelForPath(l.path).label, l.path, l.sessions, l.bounces, l.bounceRatePct]))} />}
      >
        {!data.landings.length ? <Empty text="אין עדיין מספיק ביקורים." /> : (
          <ul className="space-y-1.5 text-xs">
            {data.landings.map((l) => (
              <li key={l.path} className="flex items-start justify-between gap-3">
                <PageName path={l.path} className="min-w-0 flex-1" />
                <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">
                  {l.sessions} · <span className={l.bounceRatePct >= 70 ? "font-bold text-rose-600" : ""}>{l.bounceRatePct}% נטישה</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleCard>

      {/* ── 4. how deep, and what inside ─────────────────────────────── */}
      <CollapsibleCard
        id="depth"
        title="📏 עומק קריאה ומסך ראשון"
        summary={data.depth.length ? `${data.depth.length} עמודים · חציון ${Math.round(data.depth.reduce((a, d) => a + d.medianPct, 0) / data.depth.length)}%` : "מתחיל להיאסף"}
        hint="״מסך ראשון״ הוא איזה אחוז מהעמוד נראה בלי לגלול בכלל. הוא נחוץ כדי לקרוא את החציון נכון: חציון 34% בעמוד שמסכו הראשון מראה 30% הוא קורא שכמעט לא גלל, ובעמוד שמראה 6% הוא קורא שעבד בשביל זה."
        action={<Csv onClick={() => downloadCsv("depth", ["עמוד", "נתיב", "צפיות", "חציון %", "מסך ראשון %", "25%", "50%", "75%", "עד הסוף"], data.depth.map((d) => [labelForPath(d.path).label, d.path, d.views, d.medianPct, d.foldPct, d.p25, d.p50, d.p75, d.p100]))} />}
      >
        {!data.depth.length ? <Empty text={NOT_YET} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-xs">
              <thead className="text-2xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 text-right">עמוד</th>
                  <th className="py-1 text-left">צפיות</th>
                  <th className="py-1 text-left">חציון</th>
                  <th className="py-1 text-left">מסך ראשון</th>
                  <th className="py-1 text-left">25%</th>
                  <th className="py-1 text-left">50%</th>
                  <th className="py-1 text-left">75%</th>
                  <th className="py-1 text-left">עד הסוף</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.depth.map((d) => (
                  <tr key={d.path}>
                    <td className="max-w-[240px] py-1.5 text-right"><PageName path={d.path} /></td>
                    <td className="py-1.5 text-left tabular-nums text-slate-700">{d.views}</td>
                    <td className="py-1.5 text-left tabular-nums font-bold text-slate-900">{d.medianPct}%</td>
                    <td className="py-1.5 text-left tabular-nums text-slate-500">{d.foldPct}%</td>
                    <td className="py-1.5 text-left tabular-nums text-slate-500">{pct(d.p25, d.views)}%</td>
                    <td className="py-1.5 text-left tabular-nums text-slate-500">{pct(d.p50, d.views)}%</td>
                    <td className="py-1.5 text-left tabular-nums text-slate-500">{pct(d.p75, d.views)}%</td>
                    <td className="py-1.5 text-left tabular-nums text-slate-500">{pct(d.p100, d.views)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="sections"
        title="🔍 מה נצפה בתוך עמוד עיר"
        summary={data.sections.length ? `${data.sections.length} חלקים · הנצפה ביותר: ${sectionLabel(data.sections[0].section)}` : "מתחיל להיאסף"}
        hint="נמדד זמן שהחלק היה באמת על המסך, ולא רק ״נכנס לתצוגה״ — בעמוד ארוך כל חלק נכנס לתצוגה של מי שגלל עד הסוף, ולכן ״נראה״ כמעט זהה ל״העמוד ארוך״. ״הגיעו״ הוא אחוז מצפיות עמוד העיר שבהן החלק נצפה: חלק שמגיעים אליו 12% הוא או קבור או לא מבוקש, וטבלת העומק שמעל אומרת מה מהשניים."
        action={<Csv onClick={() => downloadCsv("sections", ["חלק", "צפיות", "% הגיעו", "זמן ממוצע (שנ׳)", "סה״כ (שנ׳)"], data.sections.map((s) => [sectionLabel(s.section), s.views, s.reachPct, s.avgSeconds, s.totalSeconds]))} />}
      >
        {!data.sections.length ? <Empty text={NOT_YET} /> : (
          <div className="space-y-1.5">
            {data.sections.map((s) => (
              <div key={s.section} className="flex items-center gap-2 text-xs">
                <span className="w-44 shrink-0 truncate text-slate-700" title={s.section}>{sectionLabel(s.section)}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, s.reachPct)}%` }} />
                </div>
                <span className="w-32 shrink-0 text-left tabular-nums text-slate-500">
                  {s.reachPct}% · {humanSeconds(s.avgSeconds)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* ── 5. speed and routes ──────────────────────────────────────── */}
      <CollapsibleCard
        id="vitals"
        title="⚡ מהירות אמיתית אצל גולשים"
        summary={data.vitals.length ? `${data.vitals.length} מדידות · ${data.vitals.filter((v) => VITAL_LIMITS[v.metric] && v.p75 > VITAL_LIMITS[v.metric].poor).length} חורגות` : "מתחיל להיאסף"}
        hint="p75 ולא ממוצע: ממוצע נגרר כלפי מטה על ידי הרוב המהיר ומסתיר בדיוק את הזנב האיטי שגורם לנטישה. p75 הוא הסף שגוגל עצמה מודדת מולו, והוא מתאר חוויה שרבע מהגולשים באמת חווים. LCP = מתי התוכן הראשי הופיע · INP = כמה מהר העמוד הגיב ללחיצה · CLS = כמה הפריסה קפצה תוך כדי טעינה."
        action={<Csv onClick={() => downloadCsv("web-vitals", ["עמוד", "נתיב", "מדד", "מכשיר", "p75", "מדידות"], data.vitals.map((v) => [labelForPath(v.path).label, v.path, v.metric, v.device, v.p75, v.n]))} />}
      >
        {!data.vitals.length ? <Empty text={NOT_YET} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-2xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 text-right">עמוד</th>
                  <th className="py-1 text-left">מדד</th>
                  <th className="py-1 text-left">מכשיר</th>
                  <th className="py-1 text-left">p75</th>
                  <th className="py-1 text-left">מדידות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.vitals.map((v) => {
                  const lim = VITAL_LIMITS[v.metric];
                  const tone = !lim ? "text-slate-700"
                    : v.p75 <= lim.good ? "text-emerald-700"
                    : v.p75 <= lim.poor ? "text-amber-700" : "font-bold text-rose-600";
                  const shown = v.metric === "CLS" ? (v.p75 / 1000).toFixed(3) : `${v.p75}${lim?.unit ?? ""}`;
                  return (
                    <tr key={`${v.path}|${v.metric}|${v.device}`}>
                      <td className="max-w-[240px] py-1.5 text-right"><PageName path={v.path} /></td>
                      <td className="py-1.5 text-left font-mono text-2xs text-slate-600">{v.metric}</td>
                      <td className="py-1.5 text-left text-slate-500">{DEVICE_HE[v.device] ?? v.device}</td>
                      <td className={`py-1.5 text-left tabular-nums ${tone}`}>{shown}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-400">{v.n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="paths"
        title="🧭 מסלולי ניווט — מאיפה לאן"
        summary={data.paths.length ? `${data.paths.length} מעברים` : "אין עדיין מספיק ביקורים"}
        hint="המעברים הנפוצים ביותר בתוך ביקור. זו השאלה שטבלת היציאות לא עונה עליה: יציאה אומרת שהביקור נגמר, וזה אומר מה הביקור עשה במקום. אם הצעד הנפוץ אחרי עמוד עיר הוא חזרה לעמוד הבית ולא מעבר להשוואה או לבדיקת מחיר — הצעד הבא הטבעי לא קיים או לא נראה משם."
        action={<Csv onClick={() => downloadCsv("paths", ["מ", "אל", "מעברים"], data.paths.map((p) => [labelForPath(p.from).label, labelForPath(p.to).label, p.n]))} />}
      >
        {!data.paths.length ? <Empty text="אין עדיין מספיק ביקורים עם יותר מעמוד אחד." /> : (
          <ul className="space-y-1.5 text-xs">
            {data.paths.map((p) => (
              <li key={`${p.from}|${p.to}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-slate-600" title={p.from}>{labelForPath(p.from).label}</span>
                <span aria-hidden className="shrink-0 text-slate-300">←</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-800" title={p.to}>{labelForPath(p.to).label}</span>
                <span className="w-10 shrink-0 text-left tabular-nums text-slate-500">{p.n}</span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleCard>

      {/* ── 6. pages, cities, users ──────────────────────────────────── */}
      <CollapsibleCard
        id="pages"
        title="📄 עמודים — צפיות וזמן"
        summary={`${data.pages.length} עמודים`}
        action={<Csv onClick={() => downloadCsv("pages", ["עמוד", "נתיב", "צפיות", "זמן ממוצע (שנ׳)", "סה״כ (שנ׳)"], data.pages.map((p) => [labelForPath(p.path).label, p.path, p.views, p.avgSeconds, p.totalSeconds]))} />}
      >
        {!data.pages.length ? <Empty text="אין עדיין נתוני עמודים." /> : (
          <ul className="space-y-1.5 text-xs">
            {data.pages.map((p) => (
              <li key={p.path} className="flex items-start justify-between gap-3">
                <PageName path={p.path} className="min-w-0 flex-1" />
                <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">
                  {p.views} צפיות · {humanSeconds(p.avgSeconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="cities"
        title="🏙️ ביקוש מול כיסוי"
        summary={`${data.cities.length} ערים · ${data.cities.filter((c) => c.quality === "thin" && c.views >= 5).length} עם מדגם דל`}
        hint="הערים הנצפות ביותר, מוצלבות עם איכות הדאטה שלהן. ״מדגם דל״ בעיר שנצפית הרבה הוא סדר העדיפויות לאיסוף — וזה המדד היחיד כאן שאף כלי חיצוני לא יכול לייצר, כי הוא דורש לדעת גם מה במאגר וגם מה נצפה."
        action={<Csv onClick={() => downloadCsv("city-demand", ["עיר", "צפיות", "חשיפות חומה", "פתיחות", "איכות"], data.cities.map((c) => [c.city, c.views, c.wallViews, c.unlocks, c.quality]))} />}
      >
        {!data.cities.length ? <Empty text="אין עדיין צפיות בעמודי ערים." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="text-2xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 text-right">עיר</th>
                  <th className="py-1 text-left">צפיות</th>
                  <th className="py-1 text-left">חשיפות חומה</th>
                  <th className="py-1 text-left">פתיחות</th>
                  <th className="py-1 text-left">כיסוי</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.cities.map((c) => (
                  <tr key={c.city} className={c.quality === "thin" && c.views >= 5 ? "bg-amber-50/60" : ""}>
                    <td className="py-1.5 text-right">
                      <PageName path={`/city/${encodeURIComponent(c.city)}`} />
                    </td>
                    <td className="py-1.5 text-left tabular-nums text-slate-700">{c.views}</td>
                    <td className="py-1.5 text-left tabular-nums text-slate-500">{c.wallViews}</td>
                    <td className="py-1.5 text-left tabular-nums text-slate-500">{c.unlocks}</td>
                    <td className="py-1.5 text-left text-2xs">
                      {c.quality === "thin"
                        ? <span className="font-bold text-amber-700">מדגם דל</span>
                        : c.quality === "ok"
                          ? <span className="text-emerald-700">תקין</span>
                          : <span className="text-slate-400">חלקי</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="users"
        title="👤 שימוש לפי משתמש"
        summary={`${data.users.length} משתמשים רשומים פעילים`}
        hint="משתמשים רשומים בלבד. גלישה אנונימית נספרת בסיכום למעלה ואינה מקושרת לזהות. לחיצה על שורה טוענת את הפירוט של אותו משתמש בלבד."
        action={<Csv onClick={() => downloadCsv("users", ["מייל", "שם", "ביקורים", "צפיות", "שניות", "חיפושים", "מכשיר", "נראה לאחרונה"], data.users.map((u) => [u.email, u.name, u.sessions, u.pageViews, u.totalSeconds, u.searches, u.device ?? "", u.lastSeen ?? ""]))} />}
      >
        <AdminUserUsageTable rows={data.users} days={days} />
      </CollapsibleCard>

      <CollapsibleCard
        id="dead-ends"
        title="😤 לחיצות זעם ומסכי שגיאה"
        summary={data.rage.length || data.errors.length ? `${data.rage.length} זעם · ${data.errors.length} שגיאות` : "נקי"}
        hint="לחיצת זעם = 3 לחיצות על אותו אלמנט תוך שנייה וחצי בלי ניווט: ״נראה לחיץ ואינו״. מסך שגיאה נרשם עם מזהה התקלה בלבד — הלוג של השרת אומר מה נשבר, וזה אומר כמה אנשים ראו."
      >
        {!data.rage.length && !data.errors.length ? (
          <Empty text="אין לחיצות זעם ואין מסכי שגיאה בתקופה — זו התוצאה הרצויה." />
        ) : (
          <div className="space-y-2">
            {data.rage.map((r) => (
              <div key={`${r.path}|${r.label}`} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-700">{r.label}</span>
                <PageName path={r.path} className="min-w-0 flex-1" />
                <span className="shrink-0 tabular-nums font-bold text-amber-700">×{r.n}</span>
              </div>
            ))}
            {data.errors.map((e) => (
              <div key={`${e.path}|${e.detail}`} className="flex items-center justify-between gap-3 rounded-lg bg-rose-50 px-2 py-1 text-xs">
                <PageName path={e.path} className="min-w-0 flex-1" />
                <code dir="ltr" className="shrink-0 font-mono text-2xs text-rose-500">{e.detail}</code>
                <span className="shrink-0 tabular-nums font-bold text-rose-700">×{e.n}</span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="searches"
        title="🔎 חיפושים"
        summary={`${data.misses.length} מונחים ללא תוצאה`}
        hint="חיפוש שלא מצא כלום הוא גולש שביקש משהו שאיננו מכסים — או מאייתים אחרת. זו רשימת המשימות הזולה ביותר שיש."
        action={<Csv onClick={() => downloadCsv("searches", ["מונח", "חיפושים", "כושלים"], data.searches.map((s) => [s.term, s.n, s.misses]))} />}
      >
        {!data.misses.length ? <Empty text="אין חיפושים כושלים בתקופה — או שאין עדיין תנועה." /> : (
          <ul className="space-y-1 text-xs">
            {data.misses.map((m) => (
              <li key={m.term} className="flex justify-between gap-2">
                <span className="truncate text-slate-700">{m.term}</span>
                <span className="tabular-nums text-slate-400">×{m.n}</span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="cohorts"
        title="🔁 קוהורטות וכלכלת קרדיטים"
        summary={`${data.cohorts.length} שבועות · ${data.credits.outstanding} קרדיטים לא מנוצלים`}
        hint="קוהורטות לפי שבוע ההרשמה: כמה מהנרשמים חזרו תוך יום, שבוע וחודש. ״יתרה לא מנוצלת״ נספרת על פני כל הזמן ולא רק בחלון הנבחר — קרדיט שהוענק ברבעון שעבר ועדיין לא נוצל הוא בדיוק מה שהמספר נועד לתפוס."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            {!data.cohorts.length ? <Empty text="אין עדיין נרשמים בתקופה." /> : (
              <table className="w-full text-xs">
                <thead className="text-2xs uppercase text-slate-400">
                  <tr><th className="py-1 text-right">שבוע</th><th className="py-1 text-left">נרשמו</th><th className="py-1 text-left">D1</th><th className="py-1 text-left">D7</th><th className="py-1 text-left">D30</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.cohorts.map((c) => (
                    <tr key={c.week}>
                      <td className="py-1.5 text-right tabular-nums text-slate-700" dir="ltr">{c.week}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-700">{c.signups}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{pct(c.d1, c.signups)}%</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{pct(c.d7, c.signups)}%</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{pct(c.d30, c.signups)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            {[
              ["הוענקו", `${data.credits.granted}`],
              ["נוצלו", `${data.credits.spent}`],
              ["פתיחות ערים", `${data.credits.unlocks}`],
              ["יתרה לא מנוצלת", `${data.credits.outstanding}`],
              ["חשבונות עם יתרה", `${data.credits.usersWithBalance}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-2xs text-slate-500">{k}</dt>
                <dd className="text-lg font-black tabular-nums text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id="raw"
        title="📈 פעילות גולמית"
        summary={`${data.events.length} סוגי אירועים`}
        hint="ספירת פעולות — לא אנשים. כולל גם את הגלישה שלך."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ul className="space-y-1 text-xs">
            {data.events.map((e) => (
              <li key={e.name} className="flex justify-between gap-2">
                <span className="text-slate-700">{EVENT_LABELS[e.name] ?? e.name}</span>
                <span className="tabular-nums text-slate-500">{e.n.toLocaleString("he-IL")}</span>
              </li>
            ))}
          </ul>
          <div>
            <p className="mb-1 text-2xs font-bold uppercase tracking-wide text-slate-400">כפתורי מפתח</p>
            {!data.ctas.length ? <Empty text={NOT_YET} /> : (
              <ul className="space-y-1 text-xs">
                {data.ctas.map((c) => (
                  <li key={c.cta} className="flex justify-between gap-2">
                    <span className="text-slate-700">{CTA_HE[c.cta] ?? c.cta}</span>
                    <span className="tabular-nums text-slate-500">{c.n} · {c.sessions} ביקורים</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CollapsibleCard>
    </div>
  );
}
