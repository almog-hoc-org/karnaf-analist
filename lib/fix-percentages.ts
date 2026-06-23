/**
 * Fix percentages + fill missing price_per_sqm from nadlan_price_trends.
 * Run: npx tsx lib/fix-percentages.ts
 */
import { prisma } from "./db";

async function main() {
  console.log("🔧 Fixing percentage format and filling missing data...\n");

  const cities = await prisma.city.findMany();
  let fixedCount = 0;
  let priceFilledCount = 0;

  for (const city of cities) {
    const updates: Record<string, number | null> = {};

    // ── Fix population_growth_pct: if stored as decimal, convert to % ──
    if (city.population_growth_pct !== null && Math.abs(city.population_growth_pct) < 1) {
      // Value like 0.082 should be 8.2
      updates.population_growth_pct = city.population_growth_pct * 100;
    }

    // ── Fix price_change_pct: if stored as decimal, convert to % ──
    if (city.price_change_pct !== null && Math.abs(city.price_change_pct) < 2) {
      // Value like 0.14 should be 14.1
      updates.price_change_pct = city.price_change_pct * 100;
    }

    // ── Fill missing price_per_sqm from nadlan_price_trends ──
    if (city.price_per_sqm_2023 === null || city.price_per_sqm_2026 === null) {
      const trends = await prisma.nadlan_price_trends.findMany({
        where: { city_name: city.city_name },
        orderBy: [{ year: "asc" }, { quarter: "asc" }],
      });

      if (trends.length > 0) {
        // For "price per sqm": nadlan_price_trends has median total prices.
        // We need to estimate price/sqm by dividing by typical apartment size (~75sqm national avg)
        const AVG_APT_SIZE = 75;

        // Find earliest available (2023 or closest)
        if (city.price_per_sqm_2023 === null) {
          const p2023 = trends.find(t => t.year === 2023 && t.quarter === 1 && t.median_price)
            ?? trends.find(t => t.year === 2023 && t.median_price)
            ?? trends.find(t => t.year === 2022 && t.quarter === 4 && t.median_price);
          if (p2023?.median_price) {
            updates.price_per_sqm_2023 = Math.round(p2023.median_price / AVG_APT_SIZE);
          }
        }

        // Find latest available
        if (city.price_per_sqm_2026 === null) {
          const latest = [...trends].reverse().find(t => t.median_price && t.median_price > 0);
          if (latest?.median_price) {
            updates.price_per_sqm_2026 = Math.round(latest.median_price / AVG_APT_SIZE);
          }
        }

        // Recalculate price_change_pct from the filled values
        const priceSqm2023 = updates.price_per_sqm_2023 ?? city.price_per_sqm_2023;
        const priceSqm2026 = updates.price_per_sqm_2026 ?? city.price_per_sqm_2026;
        if (priceSqm2023 && priceSqm2026 && priceSqm2023 > 0) {
          updates.price_change_pct = ((priceSqm2026 - priceSqm2023) / priceSqm2023) * 100;
        }

        if (updates.price_per_sqm_2023 || updates.price_per_sqm_2026) {
          priceFilledCount++;
        }
      }
    }

    // ── Apply updates ──
    if (Object.keys(updates).length > 0) {
      await prisma.city.update({
        where: { id: city.id },
        data: { ...updates, last_updated: new Date() },
      });
      fixedCount++;
    }
  }

  console.log(`✅ Fixed ${fixedCount} cities`);
  console.log(`✅ Filled price_per_sqm for ${priceFilledCount} cities from nadlan_price_trends`);

  // Verify
  const withPrice = await prisma.city.count({ where: { price_per_sqm_2026: { not: null } } });
  const sample = await prisma.city.findMany({
    take: 5,
    where: { price_per_sqm_2026: { not: null } },
    select: { city_name: true, population_growth_pct: true, price_change_pct: true, price_per_sqm_2023: true, price_per_sqm_2026: true },
  });

  console.log(`\nCities with price data: ${withPrice}/168`);
  console.log("\nSample verification:");
  for (const c of sample) {
    console.log(`  ${c.city_name}: popGrowth=${c.population_growth_pct?.toFixed(1)}%, priceChange=${c.price_change_pct?.toFixed(1)}%, priceSqm2023=${c.price_per_sqm_2023}, priceSqm2026=${c.price_per_sqm_2026}`);
  }

  await prisma.$disconnect();
  console.log("\n🏁 Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
