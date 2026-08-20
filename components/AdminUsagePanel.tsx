"use client";

import { useEffect, useState } from "react";
import AdminUserUsageTable, { humanSeconds } from "@/components/AdminUserUsageTable";
import Icon from "@/components/Icon";
import type {
  UsageSummary, UsagePageRow, UserUsageRow, VisitShape, ExitRow, LandingRow,
  FunnelStage, DeadEndRow, CityDemandRow, CreditEconomy, CohortRow, EventSummaryRow,
} from "@/lib/events";
import type { DailyRow } from "@/lib/usageRollup";

/**
 * Admin tab: what visitors actually do, and where the product loses them.
 *
 * WHY THIS BECAME A CLIENT COMPONENT
 * It used to be a server component, which read well — until you notice that
 * app/admin/page.tsx renders ALL EIGHT tabs on the server for every load and
 * AdminTabs then displays one. Every query added here was therefore paid for
 * by an operator opening "חוקי המערכת". This panel now fetches itself from
 * /api/admin/usage, so its cost belongs to whoever opens it, and the range
 * picker can change the window without a page reload.
 *
 * WHAT THE NUMBERS ARE, stated once because every panel below inherits it:
 * a "ביקור" is one browser TAB (a random id that dies with the tab), not a
 * person and not a device. Two tabs are two visits; tomorrow is a new visit.
 * Nothing here is called "משתמשים" unless it is joined to an account.
 *
 * /deals, /admin, /login and /register emit no events at all — the privacy
 * notice promises that — so they are absent from every table by construction,
 * not by filtering.
 */

const DEVICE_HE: Record<string, string> = { mobile: "📱 מובייל", tablet: "📲 טאבלט", desktop: "💻 מחשב" };

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
  scroll_depth: "ספי גלילה",
  error_shown: "מסכי שגיאה שהוצגו",
};

const CTA_HE: Record<string, string> = {
  register: "הרשמה", login: "התחברות", check_price: "בדיקת מחיר",
  calculator: "מחשבון", course_banner: "באנר הקורס", open_deals: "סביבת עבודה",
  all_rankings: "כל הדירוג",
};

interface Payload {
  days: number;
  since: string | null;
  summary: UsageSummary;
  shape: VisitShape;
  trend: DailyRow[];
  rollup: { days: number; first: string | null; last: string | null };
  pages: UsagePageRow[];
  exits: ExitRow[];
  landings: LandingRow[];
  scroll: Array<{ path: string; views: number; d25: number; d50: number; d75: number; d100: number }>;
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

function Card({ title, hint, children, action }: {
  title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {action}
      </div>
      {hint && <p className="mb-3 text-2xs leading-relaxed text-slate-500">{hint}</p>}
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-xs text-slate-400">{text}</p>;

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

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

  const { summary: sum, shape } = data;
  const deviceTotal = sum.devices.reduce((a, d) => a + d.sessions, 0);
  const funnelTop = data.funnel[0]?.n ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {picker}
        <p className="text-2xs text-slate-400">
          {data.since && <>הלוג נאסף מאז <b dir="ltr">{data.since.slice(0, 10)}</b> · </>}
          {data.rollup.days > 0
            ? <>צבירה יומית: {data.rollup.days} ימים</>
            : <>הצבירה הלילית עוד לא רצה</>}
        </p>
      </div>

      {/* ── 1. overview ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { v: shape.sessions.toLocaleString("he-IL"), l: `ביקורים · ${days} יום` },
          { v: shape.pagesPerVisit.toFixed(1), l: "עמודים לביקור" },
          { v: `${shape.bounceRatePct}%`, l: "שיעור נטישה" },
          { v: humanSeconds(sum.avgSessionSeconds), l: "זמן ממוצע לביקור" },
        ].map((k) => (
          <div key={k.l} className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-center">
            <p className="text-2xl font-black tabular-nums text-indigo-700">{k.v}</p>
            <p className="mt-1 text-2xs font-bold text-slate-600">{k.l}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="מכשירים"
          hint="נגזר מרוחב המסך וסוג המצביע — לא מ-user-agent. עונה על ״האם האתר חייב לעבוד בטלפון״ בלי להחזיק טביעת אצבע."
        >
          {deviceTotal === 0 ? <Empty text="אין עדיין נתוני מכשיר." /> : (
            <div className="space-y-1.5">
              {sum.devices.map((d) => (
                <div key={d.device} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-slate-600">{DEVICE_HE[d.device] ?? d.device}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-indigo-500" style={{ width: `${pct(d.sessions, deviceTotal)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-left tabular-nums text-slate-500">
                    {d.sessions} · {pct(d.sessions, deviceTotal)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="מקור תנועה"
          hint="דומיין מפנה בלבד, לא כתובת מלאה — כתובת חיפוש מלאה עלולה לשאת את מה שהגולש הקליד."
        >
          {!data.sources.length ? <Empty text="אין עדיין נתוני מקור. נאסף מהביקור הראשון אחרי הפריסה." /> : (
            <ul className="space-y-1 text-xs">
              {data.sources.map((s) => (
                <li key={s.source} className="flex justify-between gap-2">
                  <span dir="ltr" className="truncate text-slate-700">{s.source}</span>
                  <span className="tabular-nums text-slate-500">{s.sessions}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── 2. the funnel ────────────────────────────────────────────── */}
      <Card
        title="🎯 משפך — מביקור לחשבון פעיל"
        hint="כל שלב נספר מהמקור הזול והישר ביותר: צפיות וחשיפות מלוג האירועים, וכל מה שאחרי ההרשמה מהטבלה שרושמת את התוצאה עצמה (users, city_unlocks) — כפתור אפשר לפספס, שורה בטבלה לא. שימו לב: אלו אינם אותם אנשים ההולכים במשפך, אלא כמויות באותה תקופה."
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
      </Card>

      {/* ── 3. where visits end ──────────────────────────────────────── */}
      <Card
        title="🚪 נקודות עזיבה"
        hint="שיעור יציאה גבוה אינו רע מעצמו — העמוד האחרון של ביקור מוצלח הוא גם יציאה. מה שהופך אותו לממצא הוא שיעור יציאה גבוה יחד עם זמן שהייה קצר: הגיעו, ונטשו. שתי העמודות מוצגות כדי ששני המקרים לא יתערבבו."
        action={<Csv onClick={() => downloadCsv("exits", ["עמוד", "צפיות", "יציאות", "% יציאה", "שניות לפני עזיבה"], data.exits.map((e) => [e.path, e.views, e.exits, e.exitRatePct, e.avgSecondsBeforeExit]))} />}
      >
        {!data.exits.length ? <Empty text="אין עדיין מספיק ביקורים." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
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
                  const deadEnd = e.exitRatePct >= 60 && e.avgSecondsBeforeExit > 0 && e.avgSecondsBeforeExit < 20 && e.views >= 5;
                  return (
                    <tr key={e.path} className={deadEnd ? "bg-rose-50/60" : ""}>
                      <td className="max-w-[280px] truncate py-1.5 text-right text-slate-700" dir="ltr" title={e.path}>
                        {e.path}{deadEnd && <span title="יציאה גבוהה + שהייה קצרה — מבוי סתום"> ⚠</span>}
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
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="🛬 עמודי נחיתה ונטישה"
          hint="נטישה = ביקור שראה עמוד אחד ועזב תוך פחות מ-10 שניות. עמוד שמביא תנועה שלא נשארת הוא בעיה של התאמה בין ההבטחה לתוכן."
          action={<Csv onClick={() => downloadCsv("landings", ["עמוד", "ביקורים", "נטישות", "% נטישה"], data.landings.map((l) => [l.path, l.sessions, l.bounces, l.bounceRatePct]))} />}
        >
          {!data.landings.length ? <Empty text="אין עדיין מספיק ביקורים." /> : (
            <ul className="space-y-1 text-xs">
              {data.landings.map((l) => (
                <li key={l.path} className="flex items-baseline justify-between gap-2">
                  <span dir="ltr" className="min-w-0 truncate text-slate-700" title={l.path}>{l.path}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {l.sessions} · <span className={l.bounceRatePct >= 70 ? "font-bold text-rose-600" : ""}>{l.bounceRatePct}% נטישה</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="😤 לחיצות זעם ומסכי שגיאה"
          hint="לחיצת זעם = 3 לחיצות על אותו אלמנט תוך שנייה וחצי בלי ניווט: ״נראה לחיץ ואינו״. מסך שגיאה נרשם עם מזהה התקלה בלבד — הלוג של השרת אומר מה נשבר, וזה אומר כמה אנשים ראו."
        >
          {!data.rage.length && !data.errors.length ? (
            <Empty text="אין לחיצות זעם ואין מסכי שגיאה בתקופה — זו התוצאה הרצויה." />
          ) : (
            <div className="space-y-3">
              {data.rage.map((r) => (
                <div key={`${r.path}|${r.label}`} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-slate-700">{r.label}</span>
                  <span dir="ltr" className="shrink-0 text-2xs text-slate-400">{r.path}</span>
                  <span className="shrink-0 tabular-nums font-bold text-amber-700">×{r.n}</span>
                </div>
              ))}
              {data.errors.map((e) => (
                <div key={`${e.path}|${e.detail}`} className="flex items-baseline justify-between gap-2 rounded-lg bg-rose-50 px-2 py-1 text-xs">
                  <span dir="ltr" className="min-w-0 truncate text-rose-900" title={e.path}>{e.path}</span>
                  <code dir="ltr" className="shrink-0 font-mono text-2xs text-rose-500">{e.detail}</code>
                  <span className="shrink-0 tabular-nums font-bold text-rose-700">×{e.n}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── 4. pages and content ─────────────────────────────────────── */}
      <Card
        title="📄 עמודים — צפיות, זמן ועומק גלילה"
        hint="עומק גלילה הוא אחוז מהצפיות שהגיעו לכל סף. עמוד שרוב הקוראים עוצרים בו ברבע אינו בהכרח עמוד לא מעניין — לרוב זה עמוד שהחלק השימושי בו מתחת לקפל."
        action={<Csv onClick={() => downloadCsv("pages", ["עמוד", "צפיות", "זמן ממוצע (שנ׳)", "סה״כ (שנ׳)"], data.pages.map((p) => [p.path, p.views, p.avgSeconds, p.totalSeconds]))} />}
      >
        {!data.pages.length ? <Empty text="אין עדיין נתוני עמודים." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-2xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 text-right">עמוד</th>
                  <th className="py-1 text-left">צפיות</th>
                  <th className="py-1 text-left">זמן ממוצע</th>
                  <th className="py-1 text-left">25%</th>
                  <th className="py-1 text-left">50%</th>
                  <th className="py-1 text-left">75%</th>
                  <th className="py-1 text-left">עד הסוף</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.pages.map((p) => {
                  const s = data.scroll.find((x) => x.path === p.path);
                  const d = (n?: number) => (s && p.views ? `${pct(n ?? 0, p.views)}%` : "—");
                  return (
                    <tr key={p.path}>
                      <td className="max-w-[260px] truncate py-1.5 text-right text-slate-700" dir="ltr" title={p.path}>{p.path}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-700">{p.views}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{humanSeconds(p.avgSeconds)}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{d(s?.d25)}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{d(s?.d50)}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{d(s?.d75)}</td>
                      <td className="py-1.5 text-left tabular-nums text-slate-500">{d(s?.d100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="🏙️ ביקוש מול כיסוי"
        hint="הערים הנצפות ביותר, מוצלבות עם איכות הדאטה שלהן. ״מדגם דל״ בעיר שנצפית הרבה הוא סדר העדיפויות לאיסוף — וזה המדד היחיד כאן שאף כלי אנליטיקה חיצוני לא יכול לייצר, כי הוא דורש לדעת גם מה נמצא במאגר וגם מה נצפה."
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
                    <td className="py-1.5 text-right font-semibold text-slate-800">{c.city}</td>
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
      </Card>

      {/* ── 5. users ─────────────────────────────────────────────────── */}
      <Card
        title="👤 שימוש לפי משתמש"
        hint="משתמשים רשומים בלבד. גלישה אנונימית נספרת בסיכום למעלה ואינה מקושרת לזהות כלשהי. לחיצה על שורה טוענת את הפירוט של אותו משתמש בלבד."
        action={<Csv onClick={() => downloadCsv("users", ["מייל", "שם", "ביקורים", "צפיות", "שניות", "חיפושים", "מכשיר", "נראה לאחרונה"], data.users.map((u) => [u.email, u.name, u.sessions, u.pageViews, u.totalSeconds, u.searches, u.device ?? "", u.lastSeen ?? ""]))} />}
      >
        <AdminUserUsageTable rows={data.users} days={days} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="🔁 קוהורטות חזרה"
          hint="לפי שבוע ההרשמה: כמה מהנרשמים חזרו תוך יום, שבוע וחודש. טבלה ולא מספר אחד, כי מספר אחד לא מבדיל בין ״המוצר השתפר״ ל״התנועה של החודש הייתה גרועה יותר״."
        >
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
        </Card>

        <Card
          title="🪙 כלכלת הקרדיטים"
          hint="״יתרה לא מנוצלת״ נספרת על פני כל הזמן ולא רק בחלון הנבחר — קרדיט שהוענק ברבעון שעבר ועדיין לא נוצל הוא בדיוק מה שהמספר הזה נועד לתפוס."
        >
          <dl className="grid grid-cols-2 gap-3 text-xs">
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
        </Card>
      </div>

      {/* ── 6. raw activity ──────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="📈 פעילות באתר"
          hint="ספירת פעולות — לא אנשים. כולל גם את הגלישה שלך."
        >
          {!data.events.length ? <Empty text="אין אירועים עדיין." /> : (
            <ul className="space-y-1 text-xs">
              {data.events.map((e) => (
                <li key={e.name} className="flex justify-between gap-2">
                  <span className="text-slate-700">{EVENT_LABELS[e.name] ?? e.name}</span>
                  <span className="tabular-nums text-slate-500">{e.n.toLocaleString("he-IL")}</span>
                </li>
              ))}
            </ul>
          )}
          {data.ctas.length > 0 && (
            <>
              <p className="mt-3 text-2xs font-bold uppercase tracking-wide text-slate-400">כפתורי מפתח</p>
              <ul className="mt-1 space-y-1 text-xs">
                {data.ctas.map((c) => (
                  <li key={c.cta} className="flex justify-between gap-2">
                    <span className="text-slate-700">{CTA_HE[c.cta] ?? c.cta}</span>
                    <span className="tabular-nums text-slate-500">{c.n} · {c.sessions} ביקורים</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card
          title="🔍 חיפושים"
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
        </Card>
      </div>
    </div>
  );
}
