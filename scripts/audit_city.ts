/**
 * Per-city data audit.
 *
 * For each city, cross-reference what we have in the DB against:
 *   • CBS official population (population_by_year, source tags)
 *   • CBS 089/2026 — construction starts by city (the actual primary source PDF
 *     we downloaded; values are in /data/recent_reports.json or the file).
 *   • Yad2 Yedaata — for market type, days-on-market sanity.
 *
 * Output: a per-city verdict — "OK" / "WARN" / "ERROR" — plus the specific
 * fields that look wrong and a recommendation.
 *
 * Run:
 *   npx tsx scripts/audit_city.ts                # audits all cities
 *   npx tsx scripts/audit_city.ts "תל אביב-יפו"  # audits one
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const adapter = new PrismaBetterSqlite3({ url: path.resolve("./data/realestate.db") });
const prisma = new PrismaClient({ adapter });

// Known CBS 089/2026 city-level starts for 2025 (from PDF p.7, לוח א)
const CBS_089_2026_STARTS_2025: Record<string, number> = {
  "תל אביב-יפו": 7072,
  "ירושלים": 6868,
  "לוד": 2921,
  "רמת גן": 2909,
  "פתח תקווה": 2859,
  "אשדוד": 2379,
  "אופקים": 2345,
  "קריית גת": 2010,
  "באר שבע": 665,
  "קריית ביאליק": 662,
  "אשקלון": 645,
  "עפולה": 621,
  "חדרה": 605,
  "רמת השרון": 593,
  "הוד השרון": 536,
};

interface AuditFinding {
  level: "OK" | "WARN" | "ERROR";
  field: string;
  message: string;
}

async function auditCity(cityName: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const city = await prisma.city.findUnique({ where: { city_name: cityName } });
  if (!city) {
    return [{ level: "ERROR", field: "city", message: `not found in cities table` }];
  }

  // ── Check 1: population_2026 vs trajectory ─────────────────────────
  // If population_2026 < population_2024, that's a red flag (forecast says
  // city is shrinking, but our latest actual was higher).
  const popRows = await prisma.population_by_year.findMany({
    where: { city_name: cityName, year: { gte: 2021 } },
    orderBy: { year: "asc" },
  });
  const latestActual = popRows.filter((p) => p.source !== "interpolated" && !p.source?.includes("projection")).slice(-1)[0];
  const pop2026 = popRows.find((p) => p.year === 2026);
  if (latestActual && pop2026 && pop2026.population && latestActual.population) {
    if (pop2026.population < latestActual.population * 0.97) {
      findings.push({
        level: "ERROR",
        field: "population_2026",
        message: `2026 projection (${pop2026.population.toLocaleString("he-IL")}) is >3% below latest actual ${latestActual.year} (${latestActual.population.toLocaleString("he-IL")}). Likely a stale forecast — kills all downstream calcs.`,
      });
    }
  }

  // ── Check 2: golden_pct / apartments_required negativity ──────────
  if (city.apartments_required !== null && city.apartments_required < 0) {
    findings.push({
      level: "ERROR",
      field: "apartments_required",
      message: `negative (${city.apartments_required.toFixed(0)}) — propagates from broken pop_growth. Use new gap-analysis instead.`,
    });
  }
  if (city.golden_pct !== null && (city.golden_pct < -100 || city.golden_pct > 500)) {
    findings.push({
      level: "ERROR",
      field: "golden_pct",
      message: `out of plausible range (${city.golden_pct.toFixed(1)}%). Hide from UI.`,
    });
  }

  // ── Check 3: construction_starts 2025 vs CBS 089/2026 PDF ─────────
  const expected = CBS_089_2026_STARTS_2025[cityName];
  if (expected !== undefined) {
    const csRow = await prisma.construction_starts.findUnique({
      where: { city_name_year: { city_name: cityName, year: 2025 } },
    });
    if (!csRow || csRow.starts === null) {
      findings.push({
        level: "WARN",
        field: "construction_starts.2025",
        message: `CBS 089/2026 says ${expected.toLocaleString("he-IL")} but DB has no entry.`,
      });
    } else if (Math.abs(csRow.starts - expected) > Math.max(50, expected * 0.05)) {
      findings.push({
        level: "WARN",
        field: "construction_starts.2025",
        message: `DB=${csRow.starts.toLocaleString("he-IL")}, CBS 089/2026=${expected.toLocaleString("he-IL")} (diff=${(csRow.starts - expected).toLocaleString("he-IL")})`,
      });
    } else {
      findings.push({
        level: "OK",
        field: "construction_starts.2025",
        message: `verified vs CBS 089/2026 (${expected.toLocaleString("he-IL")})`,
      });
    }
  }

  // ── Check 4: ppa coherence ────────────────────────────────────────
  const yad2 = await prisma.yad2_market_data.findUnique({ where: { city_name: cityName } });
  if (yad2 && yad2.avg_household_size && city.avgHouseholdSize2022) {
    const diff = Math.abs(yad2.avg_household_size - city.avgHouseholdSize2022);
    if (diff > 0.5) {
      findings.push({
        level: "WARN",
        field: "household_size",
        message: `Yad2 says ${yad2.avg_household_size.toFixed(2)}, Census 2022 says ${city.avgHouseholdSize2022.toFixed(2)} — significant divergence.`,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({ level: "OK", field: "all", message: "no inconsistencies detected" });
  }
  return findings;
}

async function main() {
  const arg = process.argv[2];
  let cityNames: string[];
  if (arg) {
    cityNames = [arg];
  } else {
    const all = await prisma.city.findMany({ select: { city_name: true } });
    cityNames = all.map((c) => c.city_name);
  }

  let totalErrors = 0;
  let totalWarns = 0;
  let totalOk = 0;
  for (const name of cityNames) {
    const findings = await auditCity(name);
    const errors = findings.filter((f) => f.level === "ERROR");
    const warns = findings.filter((f) => f.level === "WARN");
    const verdict = errors.length > 0 ? "❌ ERROR" : warns.length > 0 ? "⚠️  WARN" : "✓ OK";
    const tag = errors.length > 0 ? `(${errors.length}E)` : warns.length > 0 ? `(${warns.length}W)` : "";
    console.log(`${verdict} ${name} ${tag}`);
    for (const f of findings.filter((f) => f.level !== "OK")) {
      console.log(`     [${f.level}] ${f.field}: ${f.message}`);
    }
    if (errors.length > 0) totalErrors++;
    else if (warns.length > 0) totalWarns++;
    else totalOk++;
  }

  console.log("");
  console.log(`═══ Summary: ${totalOk} OK, ${totalWarns} WARN, ${totalErrors} ERROR (${cityNames.length} total) ═══`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
