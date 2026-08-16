import { prisma } from "./db";
import { cachedMap } from "./cache";

/**
 * City-years whose NEW-build price level is an administered price
 * (מחיר למשתכן), written by scripts/flag-subsidized-cells.ts.
 *
 * What this is FOR: a percentage change measured from such a year is not a
 * market movement. מבשרת ציון's "+104% in three years" is 2022 — a year in
 * which 91% of the new-build deals closed at 52% of the local second-hand
 * median — compared against a normal year. The number is arithmetically
 * correct and substantively misleading, which is the worst kind of number to
 * publish without a note.
 *
 * Missing table (before the stage has ever run) degrades to an empty map: no
 * warnings, exactly the behaviour that shipped before this existed.
 */
export interface SubsidizedCell {
  year: number;
  nNew: number;
  nLow: number;
  share: number;
  medLow: number | null;
  medSecondhand: number | null;
}

async function loadAllUncached(): Promise<Map<string, SubsidizedCell[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      city_name: string; year: number; n_new: number; n_low: number;
      share: number; med_low: number | null; med_secondhand: number | null;
    }>>(
      `SELECT city_name, year, n_new, n_low, share, med_low, med_secondhand
         FROM city_year_subsidized ORDER BY year`
    );
    const map = new Map<string, SubsidizedCell[]>();
    for (const r of rows) {
      const list = map.get(r.city_name) ?? [];
      list.push({
        year: Number(r.year),
        nNew: Number(r.n_new),
        nLow: Number(r.n_low),
        share: Number(r.share),
        medLow: r.med_low === null ? null : Number(r.med_low),
        medSecondhand: r.med_secondhand === null ? null : Number(r.med_secondhand),
      });
      map.set(r.city_name, list);
    }
    return map;
  } catch {
    return new Map(); // stage has not run yet
  }
}

const loadAll = cachedMap(loadAllUncached, ["subsidized-years"]);

export async function citySubsidizedYears(cityName: string): Promise<SubsidizedCell[]> {
  return (await loadAll()).get(cityName) ?? [];
}

/**
 * The note to show beside a change measured over [fromYear, toYear].
 *
 * Only the WINDOW EDGES matter. A subsidized year in the middle of a window
 * affects neither endpoint, so warning about it would be noise — and this site
 * has to spend its warnings carefully to keep them meaningful.
 */
export async function subsidizedWindowNote(
  cityName: string,
  fromYear: number | null | undefined,
  toYear: number | null | undefined
): Promise<string | null> {
  if (!fromYear && !toYear) return null;
  const cells = await citySubsidizedYears(cityName);
  if (!cells.length) return null;

  const hit = cells.find((c) => c.year === fromYear) ?? cells.find((c) => c.year === toYear);
  if (!hit) return null;

  const pct = Math.round(hit.share * 100);
  const ratio = hit.medLow && hit.medSecondhand ? Math.round((hit.medLow / hit.medSecondhand) * 100) : null;
  const edge = hit.year === fromYear ? "נקודת הפתיחה" : "נקודת הסיום";
  return (
    `${edge} של החישוב (${hit.year}) מושפעת ממכירות במחיר מנהלי: ` +
    `${pct}% מהעסקאות בדירות חדשות באותה שנה נסגרו סביב ` +
    `₪${Math.round(hit.medLow ?? 0).toLocaleString("he-IL")} למ״ר` +
    (ratio ? ` — כ-${ratio}% מחציון היד-שנייה בעיר` : "") +
    `. סביר שמדובר במחיר למשתכן, ולכן השינוי משקף גם שינוי בתמהיל המכירות ולא רק בשוק.`
  );
}

/**
 * city → flagged years, as a plain object for a client component.
 *
 * A Map cannot cross the server/client boundary as a prop, and the ranking
 * card is a client component (it has year pickers).
 */
export async function loadSubsidizedByCity(): Promise<Record<string, number[]>> {
  const all = await loadAll();
  const out: Record<string, number[]> = {};
  for (const [city, cells] of all) out[city] = cells.map((c) => c.year);
  return out;
}
