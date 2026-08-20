/**
 * Admin tab: first-party usage — what visitors actually do.
 *
 * Server component on purpose: the numbers come straight from app.db at
 * render time, no API round-trip. Two datasets, both already collected by
 * lib/events.ts and until now displayed nowhere:
 *
 *   eventCounts — page/search/share activity, 7 and 30 day windows.
 *   topMisses   — searches that found NO city. The single most valuable
 *     signal in the log: every row is a visitor asking for something we
 *     don't cover (or spell differently), ranked by demand.
 */
import { eventCounts, topMisses, uniqueSessions, firstEventAt, usageSummary, topPages, usageByUser } from "@/lib/events";
import AdminUserUsageTable, { humanSeconds } from "@/components/AdminUserUsageTable";

// keys MUST match EVENT_NAMES in lib/events.ts — an unlabeled event renders
// as its raw English key, which is how the first version shipped dead labels
const EVENT_LABELS: Record<string, string> = {
  page_view: "צפיות בעמודים",
  page_leave: "יציאות מעמוד (מדידת זמן)",
  search: "חיפושי עיר",
  search_no_results: "חיפושים כושלים",
  chart_action: "פעולות בגרפים",
  drill_down: "פתיחות פירוט עסקאות",
  compare_select: "בחירות בהשוואה",
  feedback_open: "פתיחות טופס משוב",
  feedback_submit: "שליחות פידבק",
  unlock_prompt_seen: "חשיפות למסך פתיחת עיר",
  unlock_done: "פתיחות עיר בפועל",
  share_click: "לחיצות שיתוף",
  follow_city_click: "לחיצות מעקב עיר",
  no_result_suggestion_click: "לחיצות על הצעת חיפוש",
};

export default function AdminUsagePanel() {
  // all loaders fail-soft internally (lib/events.ts returns []/0 on any error)
  const week = eventCounts(7);
  const month = eventCounts(30);
  const misses = topMisses(30, 30);
  const visits7 = uniqueSessions(7);
  const visits30 = uniqueSessions(30);
  const since = firstEventAt();
  const sum = usageSummary(30);
  const pages = topPages(30, 12);
  const perUser = usageByUser(30, 200);
  const deviceTotal = sum.devices.reduce((a, d) => a + d.sessions, 0);
  const DEVICE_HE: Record<string, string> = { mobile: "📱 מובייל", tablet: "📲 טאבלט", desktop: "💻 מחשב" };

  const weekByName = new Map(week.map((r) => [r.name, r.n]));
  const monthByName = new Map(month.map((r) => [r.name, r.n]));
  const names = [...new Set([...week.map((r) => r.name), ...month.map((r) => r.name)])];

  return (
    <div className="space-y-6">
      {/* visits — the "how many actually came" number the raw event counts are not */}
      <section className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-center">
          <p className="text-3xl font-black text-indigo-700 tabular-nums">{visits7.toLocaleString("he-IL")}</p>
          <p className="mt-1 text-2xs font-bold text-slate-600">ביקורים · 7 ימים</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-3xl font-black text-slate-900 tabular-nums">{visits30.toLocaleString("he-IL")}</p>
          <p className="mt-1 text-2xs font-bold text-slate-600">ביקורים · 30 ימים</p>
        </div>
        <p className="col-span-2 text-2xs leading-relaxed text-slate-400">
          ביקור = טאב-דפדפן אחד (סשן), לא אדם ייחודי — אותו גולש מחר נספר שוב. מבקרים
          ייחודיים אמיתיים, מכשירים וזמני שהייה — ב-Clarity.
          {since && <> · הלוג נאסף מאז <b dir="ltr">{since.slice(0, 10)}</b> — חלון שקצר מזה יראה מספרים זהים לחלון הארוך.</>}
        </p>
      </section>

      {/* ── the headline summary (operator request 8/2026) ───────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-900">⏱️ סיכום שימוש · 30 יום</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["זמן גלישה מצטבר", humanSeconds(sum.totalSeconds)],
            ["זמן ממוצע לביקור", humanSeconds(sum.avgSessionSeconds)],
            ["צפיות בעמודים", sum.pageViews.toLocaleString("he-IL")],
            ["משתמשים מזוהים", sum.signedInUsers.toLocaleString("he-IL")],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center">
              <p className="text-xl font-black tabular-nums text-slate-900">{value}</p>
              <p className="mt-0.5 text-2xs font-bold text-slate-500">{label}</p>
            </div>
          ))}
        </div>

        {deviceTotal > 0 && (
          <div className="mt-4">
            <p className="text-2xs font-black uppercase tracking-wide text-slate-500">מכשירים (לפי ביקורים)</p>
            {/* One bar rather than a pie: the only question here is "how much of
                this is a phone", and a bar answers it at a glance. */}
            <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
              {sum.devices.map((d, i) => (
                <div
                  key={d.device}
                  style={{ width: `${(d.sessions / deviceTotal) * 100}%` }}
                  className={i === 0 ? "bg-indigo-600" : i === 1 ? "bg-indigo-400" : "bg-indigo-200"}
                  title={`${DEVICE_HE[d.device] ?? d.device}: ${d.sessions}`}
                />
              ))}
            </div>
            <p className="mt-1.5 flex flex-wrap gap-x-3 text-2xs text-slate-600">
              {sum.devices.map((d) => (
                <span key={d.device}>
                  {DEVICE_HE[d.device] ?? d.device} — <b className="tabular-nums">{Math.round((d.sessions / deviceTotal) * 100)}%</b>
                  <span className="text-slate-400"> ({d.sessions})</span>
                </span>
              ))}
            </p>
          </div>
        )}

        <p className="mt-3 text-2xs leading-relaxed text-slate-400">
          זמן נמדד רק כשהלשונית גלויה — לשונית שנשארה פתוחה ברקע אינה נספרת כקריאה. צפייה קצרה מ-שנייה
          אינה נרשמת כלל, וכל צפייה בודדת מוגבלת ל-30 דקות כדי שלשונית שנשכחה לא תעוות את הממוצע.
        </p>
      </section>

      {/* ── which pages hold attention ───────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-900">📄 עמודים · כניסות וזמן שהייה (30 יום)</h3>
        {pages.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">אין עדיין נתוני עמודים.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-2xs font-bold text-slate-400">
                <tr>
                  <th scope="col" className="py-1 text-right">עמוד</th>
                  <th scope="col" className="py-1 text-left">כניסות</th>
                  <th scope="col" className="py-1 text-left">זמן ממוצע</th>
                  <th scope="col" className="py-1 text-left">סה״כ זמן</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.path} className="border-t border-slate-100">
                    <td className="max-w-[320px] truncate py-1.5 text-right text-slate-700" dir="ltr" title={p.path}>
                      {decodeURIComponent(p.path)}
                    </td>
                    <td className="py-1.5 text-left tabular-nums text-slate-900">{p.views.toLocaleString("he-IL")}</td>
                    <td className="py-1.5 text-left tabular-nums text-slate-600">{humanSeconds(p.avgSeconds)}</td>
                    <td className="py-1.5 text-left font-bold tabular-nums text-indigo-700">{humanSeconds(p.totalSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── per user ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-900">👤 שימוש לפי משתמש (30 יום)</h3>
        <p className="mt-1 text-xs text-slate-500">
          לחיצה על שורה פותחת את העמודים שבהם צפה, כמה זמן שהה בכל אחד, ומה חיפש.
          נרשם רק למשתמש מחובר, ורק מה שמופיע במדיניות הפרטיות: עמודים, זמן, חיפושים וסוג מכשיר —
          בלי כתובת IP ובלי מזהה דפדפן.
        </p>
        <AdminUserUsageTable rows={perUser} days={30} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-900">📈 פעילות באתר <span className="font-normal text-2xs text-slate-400">(ספירת פעולות — לא אנשים; כולל גם את הגלישה שלך)</span></h3>
        {names.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">אין אירועים עדיין — הלוג מתחיל להיאסף עם הגולש הראשון אחרי ה-deploy.</p>
        ) : (
          <table className="mt-3 w-full max-w-md text-sm">
            <thead className="text-2xs font-bold text-slate-400">
              <tr>
                <th className="py-1 text-right">אירוע</th>
                <th className="py-1 text-left">7 ימים</th>
                <th className="py-1 text-left">30 ימים</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name) => (
                <tr key={name} className="border-t border-slate-100">
                  <td className="py-1.5 text-slate-700">{EVENT_LABELS[name] ?? name}</td>
                  <td className="py-1.5 text-left font-bold tabular-nums text-slate-900">
                    {(weekByName.get(name) ?? 0).toLocaleString("he-IL")}
                  </td>
                  <td className="py-1.5 text-left tabular-nums text-slate-500">
                    {(monthByName.get(name) ?? 0).toLocaleString("he-IL")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
        <h3 className="text-sm font-bold text-slate-900">🔍 חיפושים שלא מצאו כלום (30 יום)</h3>
        <p className="mt-1 text-xs text-slate-500">
          כל שורה כאן היא גולש שביקש משהו שאין לנו — יישוב חסר, איות שונה, או צורך שלא זיהינו. זה תור העדיפויות שהקהל כותב בעצמו.
        </p>
        {misses.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">אין חיפושים כושלים בתקופה — או שאין עדיין תנועה.</p>
        ) : (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {misses.map((m) => (
              <li key={m.term} className="flex items-center justify-between rounded-lg border border-amber-100 bg-white px-3 py-1.5 text-xs">
                <span className="font-semibold text-slate-700">{m.term}</span>
                <span className="tabular-nums text-slate-400">×{m.n}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
