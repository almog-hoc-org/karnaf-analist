import { prisma } from "./db";

/**
 * Official government median deal-price series per city, by year — from the
 * nadlan.gov.il price-trends table (median total ₪ per quarter, averaged to a
 * year). This is the "official median" line the user wants to compare our own
 * average against.
 */
export interface OfficialPricePoint {
  year: number;
  medianPrice: number | null; // median total deal price (₪)
  quarters: number;           // how many quarters backed this year (data density)
}

export async function loadOfficialPriceSeries(cityName: string): Promise<OfficialPricePoint[]> {
  const rows = await prisma.nadlan_price_trends.findMany({
    where: { city_name: cityName, median_price: { not: null, gt: 0 } },
    orderBy: [{ year: "asc" }, { quarter: "asc" }],
  });
  const byYear = new Map<number, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.median_price == null) continue;
    const cur = byYear.get(r.year) ?? { sum: 0, n: 0 };
    cur.sum += r.median_price;
    cur.n += 1;
    byYear.set(r.year, cur);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => ({ year, medianPrice: v.sum / v.n, quarters: v.n }));
}
