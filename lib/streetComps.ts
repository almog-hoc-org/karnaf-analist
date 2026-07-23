/**
 * Street-level comparison for a client's deal — REAL recent deals from the
 * independent repository, with an honest fallback ladder:
 *   street (24m, n≥3) → neighborhood (24m, n≥5) → city second-hand (price year).
 * Every result states its level + n so the UI can label what it found.
 */
import { prisma } from "./db";

export interface StreetComp {
  level: "street" | "neighborhood" | "city";
  label: string;
  medianSqm: number | null;
  n: number;
  recent: Array<{ deal_date: string; area: number | null; rooms: number | null; price: number | null; price_sqm: number | null; street: string | null; house_num: string | null }>;
}

const norm = (s: string) => s.replace(/["'`]/g, "").replace(/\s+/g, " ").trim();

export async function computeStreetComp(city: string, street: string | null, neighborhood: string | null): Promise<StreetComp> {
  // 1 · street level
  if (street && norm(street).length >= 2) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT deal_date, area, rooms, price, price_sqm, street, house_num FROM nadlan_transactions
       WHERE city_name=? AND street LIKE ? AND price_sqm > 2000 AND deal_date >= date('now','-24 months')
       ORDER BY deal_date DESC LIMIT 60`,
      city, `%${norm(street)}%`
    );
    if (rows.length >= 3) {
      const sq = rows.map((r) => Number(r.price_sqm)).sort((a, b) => a - b);
      return {
        level: "street", label: `רחוב ${norm(street)} · 24 ח׳ אחרונים`,
        medianSqm: Math.round(sq[Math.floor(sq.length / 2)]), n: rows.length, recent: rows.slice(0, 10),
      };
    }
  }
  // 2 · neighborhood level
  if (neighborhood && norm(neighborhood).length >= 2) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT deal_date, area, rooms, price, price_sqm, street, house_num FROM nadlan_transactions
       WHERE city_name=? AND neighborhood LIKE ? AND price_sqm > 2000 AND deal_date >= date('now','-24 months')
       ORDER BY deal_date DESC LIMIT 80`,
      city, `%${norm(neighborhood)}%`
    );
    if (rows.length >= 5) {
      const sq = rows.map((r) => Number(r.price_sqm)).sort((a, b) => a - b);
      return {
        level: "neighborhood", label: `שכונת ${norm(neighborhood)} · 24 ח׳ אחרונים`,
        medianSqm: Math.round(sq[Math.floor(sq.length / 2)]), n: rows.length, recent: rows.slice(0, 10),
      };
    }
  }
  // 3 · city second-hand fallback
  const [cityRow] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT median_sqm, n, year FROM nadlan_year_room_stats
     WHERE city_name=? AND scope='secondhand' AND room_bucket='all' AND n>=10
     ORDER BY year DESC LIMIT 1`,
    city
  );
  return {
    level: "city",
    label: cityRow ? `יד-2 עירוני · ${cityRow.year}` : "אין דאטה עירוני",
    medianSqm: cityRow?.median_sqm != null ? Math.round(Number(cityRow.median_sqm)) : null,
    n: cityRow ? Number(cityRow.n) : 0,
    recent: [],
  };
}
