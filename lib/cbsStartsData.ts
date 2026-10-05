/**
 * Read side of the CBS building-starts releases (lib/cbsStarts.ts,
 * scripts/collect-cbs-starts.ts): the city × year table on /national.
 *
 * The raw rows are what is cached (a plain array serializes cleanly), and an
 * empty read is never cached — before the collector's first run the table does
 * not exist, and the section simply does not render.
 */
import { prisma } from "./db";
import { cached, TAGS, TTL } from "./cache";
import { buildCityYearTable, type StartsRow, type StartsTable } from "./cbsStarts";
import { normalizeCity } from "./cityAliases";

const loadRows = cached(
  async (): Promise<StartsRow[]> => {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{
        release_no: string; release_date: string; period_end: string; period_kind: string;
        period_label: string; city_raw: string; city_name: string; starts: number | bigint;
      }>>(`SELECT release_no, release_date, period_end, period_kind, period_label, city_raw, city_name, starts
           FROM cbs_starts_release`);
      return rows.map((r) => ({
        releaseNo: r.release_no, releaseDate: r.release_date, periodEnd: r.period_end,
        periodKind: r.period_kind === "year" ? "year" : "12m", periodLabel: r.period_label,
        cityRaw: r.city_raw, city: r.city_name, starts: Number(r.starts),
      }));
    } catch {
      return []; // table not created yet
    }
  },
  ["cbs-starts-release-rows"],
  TAGS.reference,
  TTL.reference,
  true,
);

export interface StartsByCity extends StartsTable {
  /** release spelling → our city page's name, where we have the city */
  pageName: Record<string, string>;
}

export async function getStartsByCity(): Promise<StartsByCity | null> {
  const rows = await loadRows();
  if (!rows.length) return null;
  const table = buildCityYearTable(rows);
  const ours = await prisma.city.findMany({ select: { city_name: true } });
  const byNorm = new Map(ours.map((c) => [normalizeCity(c.city_name), c.city_name]));
  const pageName: Record<string, string> = {};
  for (const c of table.cities) {
    const n = byNorm.get(normalizeCity(c.city));
    if (n) pageName[c.city] = n;
  }
  return { ...table, pageName };
}
