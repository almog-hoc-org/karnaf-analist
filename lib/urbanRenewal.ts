/**
 * Urban-renewal districts per city — read side of lib/collect-urban-renewal.ts.
 *
 * The table is created by the collector on its first successful run, so before
 * that (and on any copy of the DB that predates the feature) it simply does not
 * exist. Callers get [] in that case and the city page falls back to the static
 * urban_renewal_* columns on `cities` — the feature degrades to exactly what
 * the site showed before it shipped.
 */
import { prisma } from "./db";
import { cachedMarket } from "./cache";

export interface UrbanRenewalProject {
  siteName: string | null;
  track: string | null;
  status: string | null;
  unitsExisting: number | null;
  unitsProposed: number | null;
  planId: string | null;
}

async function loadAllUncached(): Promise<Map<string, UrbanRenewalProject[]>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      city_name: string;
      site_name: string | null;
      track: string | null;
      status: string | null;
      units_existing: bigint | number | null;
      units_proposed: bigint | number | null;
      plan_id: string | null;
    }>>(
      `SELECT city_name, site_name, track, status, units_existing, units_proposed, plan_id
         FROM urban_renewal_projects
        ORDER BY units_proposed DESC NULLS LAST`
    );
    const map = new Map<string, UrbanRenewalProject[]>();
    for (const r of rows) {
      const list = map.get(r.city_name) ?? [];
      list.push({
        siteName: r.site_name,
        track: r.track,
        status: r.status,
        unitsExisting: r.units_existing === null ? null : Number(r.units_existing),
        unitsProposed: r.units_proposed === null ? null : Number(r.units_proposed),
        planId: r.plan_id,
      });
      map.set(r.city_name, list);
    }
    return map;
  } catch {
    // table not created yet — collector hasn't run since this shipped
    return new Map();
  }
}

const loadAll = cachedMarket(loadAllUncached, ["urban-renewal-projects"]);

export async function cityUrbanRenewalProjects(cityName: string): Promise<UrbanRenewalProject[]> {
  return (await loadAll()).get(cityName) ?? [];
}
