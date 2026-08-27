import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { ALIAS_NAMES } from "@/lib/cityAliases";
import { SOURCES } from "@/lib/sources";

/**
 * The site has ~200 real URLs — 168 city pages, six rankings, six stats pages,
 * 25 source pages — and had no sitemap at all, so none of them had a
 * submission path to Google beyond whatever a crawler stumbled into.
 *
 * Alias cities are excluded: they redirect to their canonical name, and a
 * sitemap should never list a URL that 3xx's.
 *
 * Priorities encode what this site is FOR. City pages are the product and the
 * long tail ("מחירי דירות ב-X"), so they rank above the marketing pages.
 */
// NOT statically generated. The build runs against an empty schema database
// (the CI gate creates one just to compile), so a prerendered sitemap listed
// zero cities — 48 URLs instead of ~200, verified in production. It has to be
// generated per request, against the real data, and cached for a day.
export const dynamic = "force-dynamic";
export const revalidate = 86_400; // a day; the city list moves once a quarter at most

const STATIC_PATHS: Array<[string, number, MetadataRoute.Sitemap[number]["changeFrequency"]]> = [
  ["/", 1.0, "daily"],
  ["/cities", 0.9, "daily"],
  ["/compare", 0.7, "weekly"],
  ["/check", 0.9, "weekly"],
  ["/calculators", 0.7, "monthly"],
  ["/national", 0.6, "weekly"],
  ["/methodology", 0.6, "monthly"],
  ["/sources", 0.5, "weekly"],
  ["/stats/supply-coverage", 0.4, "weekly"],
  ["/stats/yad2-market-data", 0.4, "weekly"],
  ["/privacy", 0.2, "yearly"],
  ["/terms", 0.2, "yearly"],
  ["/accessibility", 0.2, "yearly"],
];

const RANKING_TYPES = [
  "most-expensive", "highest-gain", "highest-gain-median",
  "highest-surplus", "highest-inventory", "new-premium",
];

const STAT_METRICS = [
  "national-construction", "avg-price-per-sqm", "total-population",
  "apartments-needed", "construction-cost-index", "national-hpi",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  let cityNames: string[] = [];
  let hoodPairs: Array<{ city_name: string; neighborhood: string }> = [];
  try {
    const rows = await prisma.city.findMany({
      where: { city_name: { notIn: ALIAS_NAMES } },
      select: { city_name: true },
      orderBy: { population_2026: "desc" },
    });
    cityNames = rows.map((r) => r.city_name);
  } catch {
    // DB unreachable at build time — ship the static half rather than nothing
  }
  try {
    // Every (city, neighbourhood) that ever cleared the sample floor has a
    // page. The floor itself is the volume cap: a cell under
    // neighborhood_min_deals was never written, so this cannot balloon into
    // thousands of thin pages.
    hoodPairs = await prisma.$queryRawUnsafe<Array<{ city_name: string; neighborhood: string }>>(
      `SELECT DISTINCT city_name, neighborhood FROM neighborhood_year_stats
        WHERE scope = 'secondhand' ORDER BY city_name, neighborhood`
    );
  } catch {
    // table not created yet — the aggregation has not run with this stage
  }

  return [
    ...STATIC_PATHS.map(([path, priority, changeFrequency]) => ({
      url: `${SITE_ORIGIN}${path}`,
      lastModified: now,
      changeFrequency,
      priority,
    })),
    ...cityNames.map((name) => ({
      url: `${SITE_ORIGIN}/city/${encodeURIComponent(name)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    // Below the cities on purpose: the city is the product, the neighbourhood
    // is its long tail — and these pages are fully public (operator, 8/2026).
    ...hoodPairs.map((h) => ({
      url: `${SITE_ORIGIN}/city/${encodeURIComponent(h.city_name)}/neighborhood/${encodeURIComponent(h.neighborhood)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...RANKING_TYPES.map((t) => ({
      url: `${SITE_ORIGIN}/rankings/${t}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...STAT_METRICS.map((m) => ({
      url: `${SITE_ORIGIN}/stats/${m}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...SOURCES.map((s) => ({
      url: `${SITE_ORIGIN}/sources/${s.id}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.3,
    })),
  ];
}
