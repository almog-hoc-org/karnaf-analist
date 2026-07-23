#!/usr/bin/env tsx
/** Bound-check audit for lib/investorMetrics.ts — run before shipping any UI on it. */
import { computeAllInvestorMetrics, REF_YEAR } from "../lib/investorMetrics";
import { prisma } from "../lib/db";

async function main() {
  const t0 = Date.now();
  const map = await computeAllInvestorMetrics();
  const all = [...map.values()];
  const bad: string[] = [];

  for (const m of all) {
    const checks: [string, boolean][] = [
      ["score-range", m.score == null || (m.score >= 0 && m.score <= 100 && Number.isFinite(m.score))],
      ["chg1y", m.chg1y == null || (Number.isFinite(m.chg1y) && Math.abs(m.chg1y) <= 80)],
      ["chg3y", m.chg3y == null || (Number.isFinite(m.chg3y) && Math.abs(m.chg3y) <= 80)],
      ["momentum", m.momentum == null || (Number.isFinite(m.momentum) && Math.abs(m.momentum) <= 100)],
      ["premium", m.newPremiumPct == null || (m.newPremiumPct >= -30 && m.newPremiumPct <= 60)],
      ["liquidity", m.liquidityPer1k == null || (m.liquidityPer1k >= 0 && m.liquidityPer1k <= 200)],
      ["gap", m.gapPctOfDemand == null || Math.abs(m.gapPctOfDemand) <= 400],
      ["no-NaN", !Object.values(m.scoreParts).some((v) => v != null && !Number.isFinite(v))],
    ];
    for (const [name, ok] of checks) if (!ok) bad.push(`${m.cityName}: ${name} FAILED (${JSON.stringify(m)})`);
  }

  const withScore = all.filter((m) => m.score != null);
  const withMomentum = all.filter((m) => m.momentum != null);
  const withPremium = all.filter((m) => m.newPremiumPct != null);
  const withLiq = all.filter((m) => m.liquidityPer1k != null);

  console.log(`cities analysed: ${all.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`score: ${withScore.length} | momentum: ${withMomentum.length} | premium: ${withPremium.length} | liquidity: ${withLiq.length}`);
  console.log(`violations: ${bad.length}`);
  bad.slice(0, 10).forEach((b) => console.log("  ✗ " + b));

  const top = [...withScore].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8);
  console.log(`\nTop-8 by score (ref ${REF_YEAR}):`);
  for (const m of top)
    console.log(
      `  ${m.cityName}: score=${m.score} chg3y=${m.chg3y?.toFixed(1)}% mom=${m.momentum?.toFixed(1)}pp liq=${m.liquidityPer1k?.toFixed(0)}/1k prem=${m.newPremiumPct?.toFixed(0) ?? "—"}% gap=${m.gapPctOfDemand?.toFixed(0) ?? "—"}% conf=${m.confidence}`
    );

  // spot sanity: תל אביב premium ~ +19% per earlier manual verification
  const ta = map.get("תל אביב-יפו");
  if (ta) console.log(`\nspot ת"א: prem=${ta.newPremiumPct?.toFixed(1)}% (${ta.newPremiumYear}) chg3y=${ta.chg3y?.toFixed(1)}% deals/yr=${ta.dealsPerYear}`);

  await prisma.$disconnect();
  process.exit(bad.length > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
