import Icon from "@/components/Icon";
import type { UrbanRenewalProject } from "@/lib/urbanRenewal";

/**
 * Urban renewal on the city page.
 *
 * Two data tiers, best available wins:
 *  1. Live district list from data.gov.il (urban_renewal_projects) — a real
 *     table of מתחמים with track/status/units, refreshed by the collector.
 *  2. The legacy static snapshot on `cities` (urban_renewal_* columns) — kept
 *     as the fallback so cities render exactly what they did before the
 *     collector's first run.
 */
export default function UrbanRenewalSection({
  projects,
  staticStatus,
  staticExisting,
  staticProposed,
}: {
  projects: UrbanRenewalProject[];
  staticStatus: string | null;
  staticExisting: number | null;
  staticProposed: number | null;
}) {
  if (!projects.length && !staticStatus) return null;

  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("he-IL"));
  const top = projects.slice(0, 10);
  const totalProposed = projects.reduce((s, p) => s + (p.unitsProposed ?? 0), 0);
  const totalExisting = projects.reduce((s, p) => s + (p.unitsExisting ?? 0), 0);

  return (
    <section className="mb-10">
      <div className="section-header">
        <div className="section-header-icon"><Icon name="refresh" size="1em" /></div>
        <div>
          <h2>התחדשות עירונית</h2>
          {projects.length > 0 && (
            <p className="text-xs text-slate-500">
              {projects.length.toLocaleString("he-IL")} מתחמים מוכרזים · הרשות הממשלתית להתחדשות עירונית (data.gov.il)
            </p>
          )}
        </div>
      </div>

      {projects.length > 0 ? (
        <div className="glass-card overflow-hidden">
          <div className="grid grid-cols-3 gap-3 border-b border-slate-100 p-4 md:p-5">
            <div>
              <p className="stat-label mb-1">מתחמים</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">{projects.length.toLocaleString("he-IL")}</p>
            </div>
            <div>
              <p className="stat-label mb-1">יח״ד מוצעות</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">{totalProposed > 0 ? totalProposed.toLocaleString("he-IL") : "—"}</p>
            </div>
            <div>
              <p className="stat-label mb-1">יח״ד קיימות</p>
              <p className="text-lg font-bold text-slate-700 tabular-nums">{totalExisting > 0 ? totalExisting.toLocaleString("he-IL") : "—"}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-right text-2xs font-bold text-slate-500">
                  <th className="px-4 py-2.5">מתחם</th>
                  <th className="px-3 py-2.5">מסלול</th>
                  <th className="px-3 py-2.5">סטטוס</th>
                  <th className="px-3 py-2.5 text-left">יח״ד קיימות</th>
                  <th className="px-3 py-2.5 text-left">יח״ד מוצעות</th>
                </tr>
              </thead>
              <tbody>
                {top.map((p, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{p.siteName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">{p.track ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">{p.status ?? "—"}</td>
                    <td className="px-3 py-2.5 text-left tabular-nums text-slate-700">{fmt(p.unitsExisting)}</td>
                    <td className="px-3 py-2.5 text-left tabular-nums font-bold text-slate-900">{fmt(p.unitsProposed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-2xs text-slate-500">
            {projects.length > top.length ? (
              <span>מוצגים {top.length} המתחמים הגדולים מתוך {projects.length.toLocaleString("he-IL")}, לפי יח״ד מוצעות</span>
            ) : <span />}
            <a
              href="https://mavat.iplan.gov.il/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-indigo-700 hover:underline"
            >
              איתור תוכנית באתר מנהל התכנון ↗
            </a>
          </div>
        </div>
      ) : (
        <div className="glass-card p-4 md:p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div>
              <p className="stat-label mb-1">סטטוס</p>
              <p className="text-lg font-bold text-slate-900">{staticStatus}</p>
            </div>
            {staticProposed !== null && (
              <div>
                <p className="stat-label mb-1">יחידות מוצעות</p>
                <p className="text-lg font-bold text-slate-900">{fmt(staticProposed)}</p>
              </div>
            )}
            {staticExisting !== null && (
              <div>
                <p className="stat-label mb-1">יחידות קיימות</p>
                <p className="text-lg font-bold text-slate-700">{fmt(staticExisting)}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
