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
import { eventCounts, topMisses } from "@/lib/events";

const EVENT_LABELS: Record<string, string> = {
  page_view: "צפיות בעמודים",
  search: "חיפושי עיר",
  search_miss: "חיפושים כושלים",
  share: "שיתופים",
  feedback_open: "פתיחות טופס משוב",
};

export default function AdminUsagePanel() {
  let week: Array<{ name: string; n: number }> = [];
  let month: Array<{ name: string; n: number }> = [];
  let misses: Array<{ term: string; n: number }> = [];
  try {
    week = eventCounts(7);
    month = eventCounts(30);
    misses = topMisses(30, 30);
  } catch { /* events table appears with the first visitor — empty panel beats a crash */ }

  const monthByName = new Map(month.map((r) => [r.name, r.n]));
  const names = [...new Set([...week.map((r) => r.name), ...month.map((r) => r.name)])];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-900">📈 פעילות באתר</h3>
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
                    {(week.find((r) => r.name === name)?.n ?? 0).toLocaleString("he-IL")}
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
