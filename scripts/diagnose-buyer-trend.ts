#!/usr/bin/env tsx
/**
 * Is the "buyers vs last year" figure a market move or a reporting artifact?
 *
 * WHY THIS EXISTS. The first production run of the hot-cities cards printed
 * −49.5% for Haifa and −46.8% for Kiryat Ata while Be'er Sheva printed +21.8%.
 * Two of three cities halving is exactly the shape a truncated data feed makes,
 * and it is also exactly the shape a cooling market makes — the two are
 * indistinguishable from the totals alone.
 *
 * Deals reach the tax authority weeks after they close, so the newest months
 * are always under-reported. lib/hotCities.ts already backs the comparison
 * cutoff off by a full month for that reason, and the question this answers is
 * whether ONE month is enough.
 *
 * The monthly profile settles it. A truncated feed falls off a cliff in the
 * last month or two and looks normal before that; a cooling market is down
 * across the whole year. Nothing else needs to be argued.
 *
 *   npx tsx scripts/diagnose-buyer-trend.ts [city...]
 */
import { prisma } from "../lib/db";
import { getRuleText } from "../lib/systemRules";

const HE_MONTHS = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];

async function main() {
  const [maxRow] = await prisma.$queryRawUnsafe<Array<{ d: string | null }>>(
    "SELECT MAX(deal_date) d FROM nadlan_transactions WHERE COALESCE(excluded,0)=0"
  );
  console.log(`העסקה האחרונה במאגר: ${maxRow?.d ?? "—"}`);
  if (!maxRow?.d) return 1;

  const maxDate = new Date(`${maxRow.d}T00:00:00Z`);
  const year = maxDate.getUTCFullYear();
  console.log(
    "החלון בפועל נקבע בקוד לפי החודש האחרון שדווח במלואו (יחס ארצי שנה-מול-שנה ≥ 0.70),\n" +
    "וההשוואה היא 12 חודשים מול 12 שקדמו להם. הטבלאות למטה מראות למה זה נחוץ.\n"
  );

  const cities = process.argv.slice(2).length
    ? process.argv.slice(2)
    : getRuleText("hot_cities", "חיפה,באר שבע,קריית אתא").split(",").map((c) => c.trim()).filter(Boolean);

  // National first — a cliff visible across the whole country is the feed, and
  // no per-city reading means anything until that is ruled in or out.
  for (const scope of ["ארצי", ...cities]) {
    const national = scope === "ארצי";
    const rows = await prisma.$queryRawUnsafe<Array<{ y: number; m: string; n: bigint }>>(
      `SELECT deal_year y, substr(deal_date, 6, 2) m, COUNT(*) n
         FROM nadlan_transactions
        WHERE COALESCE(excluded,0)=0 AND is_secondhand = 1
          AND deal_year IN (?, ?) ${national ? "" : "AND city_name = ?"}
        GROUP BY deal_year, m ORDER BY y, m`,
      ...(national ? [year, year - 1] : [year, year - 1, scope])
    );

    const get = (y: number, m: number) =>
      Number(rows.find((r) => Number(r.y) === y && Number(r.m) === m + 1)?.n ?? 0);

    const prev = HE_MONTHS.map((_, i) => get(year - 1, i));
    const cur = HE_MONTHS.map((_, i) => get(year, i));

    console.log(scope);
    console.log(`  חודש   ${HE_MONTHS.map((m) => m.padStart(5)).join("")}`);
    console.log(`  ${year - 1}   ${prev.map((n) => String(n).padStart(5)).join("")}`);
    console.log(`  ${year}   ${cur.map((n) => String(n).padStart(5)).join("")}`);

    // The tell: the ratio month by month. A feed that is merely late shows
    // ~1.0 early in the year and collapses at the tail; a market that cooled
    // shows a depressed ratio from January.
    const ratio = HE_MONTHS.map((_, i) => (prev[i] > 0 ? cur[i] / prev[i] : NaN));
    console.log(`  יחס    ${ratio.map((r) => (Number.isFinite(r) ? r.toFixed(2).padStart(5) : "    —")).join("")}`);

    const early = ratio.slice(0, 3).filter(Number.isFinite);
    const earlyAvg = early.length ? early.reduce((a, b) => a + b, 0) / early.length : NaN;
    const lastReported = cur.reduce((acc, n, i) => (n > 0 ? i : acc), -1);
    console.log(
      `  ← יחס ינו–מרץ ${Number.isFinite(earlyAvg) ? earlyAvg.toFixed(2) : "—"}` +
      ` · חודש אחרון עם עסקאות: ${lastReported >= 0 ? HE_MONTHS[lastReported] : "—"}` +
      (Number.isFinite(earlyAvg) && earlyAvg > 0.85
        ? "  → תחילת השנה תקינה: הירידה בזנב היא פיגור דיווח, לא שוק"
        : "  → הירידה מופיעה כבר בתחילת השנה: נראית אמיתית") + "\n"
    );
  }
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => { console.error("threw:", e); process.exit(1); });
