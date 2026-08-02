/**
 * Market insights POOL — many concrete, self-explanatory insights (no invented
 * metrics), price-change ones are SECOND-HAND based (user rule). The home page
 * shows 4 at a time with a "show more" rotation; the pool is built so every
 * consecutive window of 4 mixes at least two price tiers (cheap/mid/expensive).
 */
import { prisma } from "./db";
import { computeAllInvestorMetrics } from "./investorMetrics";
import { refYear } from "./refYear";
import { loadSecondhandChanges } from "./cityChangeMetrics";
import { loadCityTransactionPrices } from "./cityTransactionPrices";

export type PriceTier = "cheap" | "mid" | "expensive";

export interface MarketInsight {
  key: string;
  icon: string;
  title: string;
  body: string;
  cityName: string;
  href: string;
  value: number | null;
  valueLabel: string;
  provenance: string;
  tier: PriceTier;
}

const fmt = (v: number, d = 1) => v.toFixed(d).replace(/\.0$/, "");
/** A function: as a const the year was baked in at import time. */
const prov = () => `מאגר העסקאות העצמאי (רשות המסים) · עד ${refYear()}`;

function tierOf(medianShSqm: number | null | undefined): PriceTier {
  if (medianShSqm == null) return "mid";
  if (medianShSqm < 12_000) return "cheap";
  if (medianShSqm > 25_000) return "expensive";
  return "mid";
}

/** Interleave by tier so any 4-window shows at least 2 tiers. */
function interleaveTiers(pool: MarketInsight[]): MarketInsight[] {
  const buckets: Record<PriceTier, MarketInsight[]> = { cheap: [], mid: [], expensive: [] };
  for (const i of pool) buckets[i.tier].push(i);
  const order: PriceTier[] = ["expensive", "cheap", "mid"];
  const out: MarketInsight[] = [];
  let idx = 0;
  while (out.length < pool.length) {
    const t = order[idx % 3];
    const next = buckets[t].shift();
    if (next) out.push(next);
    else if (buckets.cheap.length + buckets.mid.length + buckets.expensive.length > 0) {
      const any = buckets.expensive.shift() ?? buckets.cheap.shift() ?? buckets.mid.shift();
      if (any) out.push(any);
    }
    idx++;
  }
  return out;
}

export async function computeMarketInsights(): Promise<MarketInsight[]> {
  // one reference year for every insight produced by this call
  const ry = refYear();
  const [sh3, sh1, prices, inv, activeStreets, volumeRows] = await Promise.all([
    loadSecondhandChanges(3),
    loadSecondhandChanges(1),
    loadCityTransactionPrices(),
    computeAllInvestorMetrics().catch(() => new Map()),
    // most active street per city, last 24 months (real street-level data)
    prisma.$queryRawUnsafe<Array<{ city_name: string; street: string; n: number }>>(
      `SELECT city_name, street, COUNT(*) n FROM nadlan_transactions
       WHERE street IS NOT NULL AND COALESCE(excluded,0)=0 AND deal_date >= date('now','-24 months')
       GROUP BY city_name, street HAVING n >= 25 ORDER BY n DESC LIMIT 40`
    ).catch(() => []),
    // yearly deal volume (scope=all) for volume-jump insights
    prisma.$queryRawUnsafe<Array<{ city_name: string; year: number; n: number }>>(
      `SELECT city_name, year, n FROM nadlan_year_room_stats
       WHERE room_bucket='all' AND scope='all' AND year IN (?, ?)`,
      ry, ry - 3
    ).catch(() => []),
  ]);

  const sh1Map = new Map(sh1.map((c) => [c.city_name, c]));
  const t = (city: string) => tierOf(prices.get(city)?.medianShSqm);
  const depthOk = (city: string) => (prices.get(city)?.totalDeals ?? 0) >= 800;
  const pool: MarketInsight[] = [];
  const cap = <T,>(arr: T[], n: number) => arr.slice(0, n);

  // 1 · sharp second-hand risers (top 6 with depth)
  for (const c of cap(sh3.filter((c) => c.pct > 18 && depthOk(c.city_name)), 6)) {
    pool.push({
      key: `rise-${c.city_name}`, icon: "🚀", tier: t(c.city_name),
      title: `${c.city_name} — זינוק ביד שנייה`,
      body: `מחירי יד-2 עלו ‎+${fmt(c.pct)}% בשלוש שנים (${c.fromY}→${c.toY}, ₪/מ"ר ממוצע) — מהעליות החדות בישראל.`,
      cityName: c.city_name, href: `/city/${encodeURIComponent(c.city_name)}`,
      value: c.pct, valueLabel: `שינוי יד-2 3 שנים (${c.fromY}→${c.toY})`, provenance: prov(),
    });
  }

  // 2 · stalls/drops: positive 3y but flat/negative last year
  for (const c of cap(
    sh3.filter((c) => c.pct > 8 && (sh1Map.get(c.city_name)?.pct ?? 99) <= 0.5 && depthOk(c.city_name)),
    5
  )) {
    const y1 = sh1Map.get(c.city_name)!;
    pool.push({
      key: `stall-${c.city_name}`, icon: "🧊", tier: t(c.city_name),
      title: `${c.city_name} — העלייה נעצרה`,
      body: `אחרי ‎+${fmt(c.pct)}% ב-3 שנים, יד-2 ${y1.pct < 0 ? `ירדה ‎${fmt(y1.pct)}%` : "נותרה ללא שינוי"} בשנה האחרונה (${y1.fromY}→${y1.toY}).`,
      cityName: c.city_name, href: `/city/${encodeURIComponent(c.city_name)}`,
      value: y1.pct, valueLabel: `שינוי יד-2 שנתי (${y1.fromY}→${y1.toY})`, provenance: prov(),
    });
  }

  // 3 · new-build near second-hand price (low premium)
  const premiums = [...inv.values()].filter(
    (m: any) => m.newPremiumPct != null && m.confidence !== "low"
  ) as any[];
  for (const m of cap(premiums.sort((a, b) => a.newPremiumPct - b.newPremiumPct).filter((m) => m.newPremiumPct < 6), 5)) {
    pool.push({
      key: `prem-${m.cityName}`, icon: "🆕", tier: t(m.cityName),
      title: `${m.cityName} — חדשה כמעט במחיר יד-2`,
      body: `פער המחיר למ"ר בין דירה חדשה ליד-שנייה הוא ‎${fmt(m.newPremiumPct)}% בלבד (${m.newPremiumYear}) — נקודת כניסה מעניינת לשוק החדש.`,
      cityName: m.cityName, href: `/city/${encodeURIComponent(m.cityName)}`,
      value: null, valueLabel: `פרמיית חדשות ${m.newPremiumYear}`, provenance: `${prov()} · לפי שנת בנייה`,
    });
  }

  // 4 · supply pressure (rise + CBS shortage)
  const sh3Map = new Map(sh3.map((c) => [c.city_name, c.pct]));
  for (const m of cap(
    premiums.concat([...inv.values()] as any[])
      .filter((m: any, i, arr) => arr.findIndex((x: any) => x.cityName === m.cityName) === i)
      .filter((m: any) => (m.gapPctOfDemand ?? 0) > 120 && (sh3Map.get(m.cityName) ?? 0) > 10)
      .sort((a: any, b: any) => b.gapPctOfDemand - a.gapPctOfDemand),
    4
  ) as any[]) {
    pool.push({
      key: `gap-${m.cityName}`, icon: "🏗️", tier: t(m.cityName),
      title: `${m.cityName} — ביקוש עודף על ההיצע`,
      body: `יד-2 עלתה ‎+${fmt(sh3Map.get(m.cityName)!)}% ב-3 שנים וההיצע החדש מכסה חלק קטן מהביקוש (פער ${fmt(m.gapPctOfDemand, 0)}%) — לחץ מחירים מובנה.`,
      cityName: m.cityName, href: `/city/${encodeURIComponent(m.cityName)}`,
      value: sh3Map.get(m.cityName)!, valueLabel: `שינוי יד-2 3 שנים (עד ${ry})`,
      provenance: `${prov()} · היצע: למ"ס`,
    });
  }

  // 5 · most active streets (real street-level data)
  const seenStreetCity = new Set<string>();
  for (const s of cap(activeStreets.filter((s) => { const k = s.city_name; if (seenStreetCity.has(k)) return false; seenStreetCity.add(k); return true; }), 6)) {
    pool.push({
      key: `street-${s.city_name}`, icon: "📍", tier: t(s.city_name),
      title: `${s.city_name} — הרחוב הפעיל בעיר`,
      body: `רחוב ${s.street} ריכז ${Number(s.n).toLocaleString("he-IL")} עסקאות ב-24 החודשים האחרונים — הרחוב הנסחר ביותר בעיר.`,
      cityName: s.city_name, href: `/city/${encodeURIComponent(s.city_name)}`,
      value: null, valueLabel: `עסקאות ברחוב · 24 ח׳ אחרונים`, provenance: prov(),
    });
  }

  // 6 · volume jumps (deal count REF vs REF-3)
  const volByCity = new Map<string, { now?: number; before?: number }>();
  for (const r of volumeRows) {
    const cur = volByCity.get(r.city_name) ?? {};
    if (Number(r.year) === ry) cur.now = Number(r.n);
    else cur.before = Number(r.n);
    volByCity.set(r.city_name, cur);
  }
  const volJumps = [...volByCity.entries()]
    .filter(([city, v]) => (v.now ?? 0) >= 150 && (v.before ?? 0) >= 80 && v.now! / v.before! >= 1.5 && depthOk(city))
    .map(([city, v]) => ({ city, pct: (v.now! / v.before! - 1) * 100, now: v.now! }))
    .sort((a, b) => b.pct - a.pct);
  for (const v of cap(volJumps, 4)) {
    pool.push({
      key: `vol-${v.city}`, icon: "🔄", tier: t(v.city),
      title: `${v.city} — קפיצה במספר העסקאות`,
      body: `${v.now.toLocaleString("he-IL")} עסקאות ב-${ry} — זינוק של ‎${fmt(v.pct, 0)}% לעומת לפני 3 שנים. שוק פעיל בהרבה.`,
      cityName: v.city, href: `/city/${encodeURIComponent(v.city)}`,
      value: v.pct, valueLabel: `שינוי בנפח עסקאות (${ry - 3}→${ry})`, provenance: prov(),
    });
  }

  return interleaveTiers(pool);
}
