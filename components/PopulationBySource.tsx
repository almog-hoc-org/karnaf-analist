import type { PopulationByYearAndSource } from "@/lib/population-sources";
import NumberCaption from "./NumberCaption";
import Icon from "@/components/Icon";

/**
 * Per-city multi-source population matrix.
 * Each row = one year. Each cell inside = one source's estimate.
 * Highlights years where sources disagree (yellow tint, max spread shown).
 */
export default function PopulationBySource({
  data,
  cityName,
}: {
  data: PopulationByYearAndSource[];
  cityName: string;
}) {
  if (data.length === 0) {
    return (
      <section className="mb-10">
        <div className="section-header mb-4">
          <div className="section-header-icon"><Icon name="users" size="1em" /></div>
          <div><h2>אומדני אוכלוסייה לפי מקור</h2><p>אין נתונים זמינים</p></div>
        </div>
      </section>
    );
  }

  // Compute a few high-level numbers for the header
  const yearsWithDisagreement = data.filter((d) => !d.uniform).length;
  const totalSources = new Set<string>();
  for (const d of data) for (const e of d.estimates) totalSources.add(e.source);

  return (
    <section className="mb-10">
      <div className="section-header mb-4">
        <div className="section-header-icon"><Icon name="users" size="1em" /></div>
        <div className="flex-1">
          <h2>אומדני אוכלוסייה לפי מקור</h2>
          <p>
            {totalSources.size} מקורות שונים • {data.length} שנים זמינות
            {yearsWithDisagreement > 0 && (
              <> • <strong className="text-indigo-700">{yearsWithDisagreement} שנים עם פערים בין מקורות</strong></>
            )}
          </p>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-pin-first w-full text-sm" dir="rtl">
            <thead className="bg-slate-50/70">
              <tr className="border-b border-slate-200">
                <th className="py-3 px-3 text-right text-xs text-slate-500 font-bold w-20">שנה</th>
                <th className="py-3 px-3 text-right text-xs text-slate-500 font-bold">אומדנים פר מקור</th>
                <th className="py-3 px-3 text-center text-xs text-slate-500 font-bold w-32">פער</th>
                <th className="py-3 px-3 text-right text-xs text-slate-500 font-bold w-40">המומלץ ביותר</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const rowTint = row.uniform ? "" : "bg-slate-100/60";
                return (
                  <tr key={row.year} className={`border-b border-slate-100 ${rowTint}`}>
                    <td className="py-3 px-3 align-top">
                      <div className="text-lg font-extrabold tabular-nums text-slate-900">{row.year}</div>
                      {!row.uniform && (
                        <div className="text-2xs text-slate-600 font-bold mt-0.5"><Icon name="warning" size="1em" /> פערים</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {row.estimates.map((e) => {
                          // Unified palette — source chips share one neutral chrome;
                          // the text label is what distinguishes sources.
                          const ring = "ring-slate-200 bg-slate-50/70";
                          const textCol = "text-indigo-700";
                          return (
                            <div
                              key={e.source}
                              className={`rounded-lg px-2.5 py-1 ring-1 ring-inset ${ring} flex items-center gap-2`}
                              title={e.meta.description}
                            >
                              <span className={`text-2xs font-bold ${textCol}`}>{e.meta.label}</span>
                              <span className="text-slate-300">|</span>
                              <span className="text-sm font-bold text-slate-900 tabular-nums">
                                {e.population.toLocaleString("he-IL")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-3 px-3 align-top text-center">
                      {row.uniform ? (
                        <span className="text-2xs text-emerald-700 font-semibold"><Icon name="check" size="1em" /> אחיד</span>
                      ) : (
                        <div>
                          <div className="text-sm font-bold text-slate-900 tabular-nums">
                            {(row.max - row.min).toLocaleString("he-IL")}
                          </div>
                          <div className="text-2xs text-slate-500">{row.spreadPct.toFixed(1)}%</div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 align-top">
                      <div className="text-base font-extrabold text-slate-900 tabular-nums">
                        {row.bestPick.value.toLocaleString("he-IL")}
                      </div>
                      <div className="text-2xs text-slate-500 truncate">
                        {row.estimates.find((e) => e.source === row.bestPick.source)?.meta.label}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 text-2xs text-slate-600 leading-relaxed">
          <strong className="text-slate-800">איך לקרוא את הטבלה:</strong> כל שנה מציגה את כל האומדנים הרשמיים שמצאנו עבור{" "}
          <strong>{cityName}</strong>. כשהמקורות מסכימים — &quot;אחיד&quot;. כשהם חלוקים — מוצגים גם הפער המוחלט וגם
          ה-% (max-min relative to min). העמודה הימנית מציגה את המומלץ ביותר לפי דירוג איכות המקור:
          מפקד 2022 ← מרשם 2025 ← היתרים 2024 ← תחזיות.
        </div>
      </div>

      <NumberCaption
        source="מאגר population_estimates"
        period={`${data[0].year} - ${data[data.length - 1].year}`}
        method={'מאוחד מ-12 פרסומי למ"ס + data.gov.il + מחקר פנימי'}
      />
    </section>
  );
}
