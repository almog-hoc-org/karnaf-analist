/**
 * GovNadlan Service — fetches real estate deals from Govmap API
 * Data source: govmap.gov.il (same database as nadlan.gov.il — Israel Tax Authority)
 *
 * Comparison model:
 *  - 3 neighborhoods with ≥15 deals/year overall
 *  - Per neighborhood: pick top streets, compare prices/sqm for 60/80/100 sqm
 *  - Time periods: current year, -3y, -5y
 *  - Per (street × size × period) fallback: 15 → 10 → 5 deals → single closest deal
 *  - "Single deal" rule: same address or within 3 house-number blocks
 *  - Never invent: if no data — return null (UI must not render empty cells)
 */

const GOVMAP_BASE = "https://www.govmap.gov.il/api";
const VALID_ASSET_TYPES = ["דירה", "דירת גן", "דירת גג", "פנטהאוז", "דופלקס"];
const REQUEST_DELAY_MS = 400;

// Deal-count thresholds for the fallback hierarchy.
// Order matters — we pick the highest threshold the data supports.
// Last fallback is "1 deal" — we never show empty when at least one matching deal exists.
const THRESHOLDS = [15, 10, 5, 2, 1] as const;
type ThresholdValue = (typeof THRESHOLDS)[number];

// Area-similarity tolerance for "same size" comparisons (per user spec: ±15%).
const SAME_SIZE_TOLERANCE = 0.15;

// ── Types ────────────────────────────────────────────────────────

export interface NadlanDeal {
  dealDate: string;
  dealAmount: number;
  propertyTypeDescription: string | null;
  assetRoomNum: number | null;
  floorNo: string | null;
  assetArea: number | null;
  streetNameHeb: string | null;
  houseNum: number | null;
  neighborhood: string | null;
  settlementNameHeb: string | null;
  dealId?: number;
}

// Aggregated sample (≥2 deals — single deals use SingleSample type)
export interface AggregatedSample {
  type: "aggregated";
  count: number;
  threshold: ThresholdValue;
  avgPricePerSqm: number;
  avgTotalPrice: number;
  avgArea: number;
}

// Single-deal sample (no aggregate possible)
export interface SingleSample {
  type: "single";
  pricePerSqm: number;
  totalPrice: number;
  area: number;
  houseNum: number | null;
  streetName: string;
  blocksAway: number; // 0 = same house, 1-3 = within 3 blocks
  dealDate: string;
}

export type DealSample = AggregatedSample | SingleSample;

export interface PeriodData {
  period: "current" | "minus3" | "minus5";
  year: number;
  sample: DealSample | null;
}

export interface SizeBucketResult {
  label: string;
  targetArea: number;
  minArea: number;
  maxArea: number;
  periods: PeriodData[];
}

export interface StreetComparison {
  streetName: string;
  totalDeals: number;
  sizeBuckets: SizeBucketResult[];
}

export interface NeighborhoodComparison {
  neighborhood: string;
  totalDeals: number;
  dealsPerYearAvg: number;
  streets: StreetComparison[];
}

export interface CityDealsData {
  cityName: string;
  lastUpdated: string;
  neighborhoods: NeighborhoodComparison[];
  totalDealsAnalyzed: number;
  periodYears: { current: number; minus3: number; minus5: number };
  townCharacter: string; // "דירות", "בתים פרטיים", "מעורב", "יישוב קטן"
  note?: string; // shown when fallback bucket sizes used
}

const STANDARD_BUCKETS = [
  { label: '~60 מ"ר', targetArea: 60, minArea: 50, maxArea: 70 },
  { label: '~80 מ"ר', targetArea: 80, minArea: 70, maxArea: 90 },
  { label: '~100 מ"ר', targetArea: 100, minArea: 90, maxArea: 115 },
];

// ── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pricePerSqm(deal: NadlanDeal): number | null {
  if (!deal.assetArea || deal.assetArea <= 0 || !deal.dealAmount) return null;
  return deal.dealAmount / deal.assetArea;
}

function isValidDeal(deal: NadlanDeal): boolean {
  if (!deal.dealAmount || deal.dealAmount <= 0) return false;
  if (!deal.assetArea || deal.assetArea < 20 || deal.assetArea > 500) return false;
  if (deal.propertyTypeDescription && !VALID_ASSET_TYPES.includes(deal.propertyTypeDescription)) {
    return false;
  }
  const ppsm = pricePerSqm(deal)!;
  if (ppsm < 2000 || ppsm > 200000) return false;
  return true;
}

function removeOutliers(values: number[]): number[] {
  if (values.length < 5) return values;
  const mean = values.reduce((s, p) => s + p, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, p) => s + (p - mean) ** 2, 0) / values.length);
  if (std === 0) return values;
  return values.filter((p) => Math.abs(p - mean) <= 2 * std);
}

function avgOfArray(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function dealYear(deal: NadlanDeal): number {
  return new Date(deal.dealDate).getFullYear();
}

// ── API Calls ────────────────────────────────────────────────────

async function govmapFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "RealEstateDashboard/1.0",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Govmap API error: ${res.status} ${res.statusText}`);
  }
  return res;
}

async function searchCityCoordinates(
  cityName: string
): Promise<{ x: number; y: number } | null> {
  const res = await govmapFetch(`${GOVMAP_BASE}/search-service/autocomplete`, {
    method: "POST",
    body: JSON.stringify({
      searchText: cityName,
      language: "he",
      isAccurate: false,
      maxResults: 5,
    }),
  });
  const data = await res.json();
  const settlement = data.results?.find(
    (r: { type: string }) => r.type === "settlement"
  );
  const result = settlement || data.results?.[0];
  if (!result?.shape) return null;

  const match = result.shape.match(/POINT\(([^ ]+) ([^ ]+)\)/);
  if (!match) return null;
  return {
    x: Math.round(parseFloat(match[1])),
    y: Math.round(parseFloat(match[2])),
  };
}

async function getDealsByRadius(
  x: number,
  y: number,
  radius: number
): Promise<
  {
    polygon_id: string;
    streetNameHeb: string;
    houseNum: number;
    dealscount: string;
    settlementNameHeb: string;
  }[]
> {
  const res = await govmapFetch(
    `${GOVMAP_BASE}/real-estate/deals/${x},${y}/${radius}`
  );
  return res.json();
}

async function getNeighborhoodDeals(
  polygonId: string,
  startDate: string,
  endDate: string,
  limit: number = 2000
): Promise<{ totalCount: string; data: NadlanDeal[] }> {
  const url = `${GOVMAP_BASE}/real-estate/neighborhood-deals/${polygonId}?limit=${limit}&startDate=${startDate}&endDate=${endDate}`;
  const res = await govmapFetch(url);
  return res.json();
}

// ── Town Character Detection ─────────────────────────────────────

function detectTownCharacter(deals: NadlanDeal[]): string {
  const areas = deals
    .map((d) => d.assetArea)
    .filter((a): a is number => a !== null && a > 0);
  if (areas.length < 10) return "יישוב קטן";

  const sorted = [...areas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const largeCount = areas.filter((a) => a >= 120).length;
  const largePct = largeCount / areas.length;

  if (median >= 140 && largePct > 0.5) return "בתים פרטיים";
  if (median >= 100 && largePct > 0.3) return "מעורב";
  return "דירות";
}

function getSizeBuckets(deals: NadlanDeal[], character: string) {
  if (character === "דירות") return STANDARD_BUCKETS;

  // For house/mixed towns: compute median and build 3 buckets around it
  const areas = deals
    .map((d) => d.assetArea)
    .filter((a): a is number => a !== null && a > 0)
    .sort((a, b) => a - b);

  if (areas.length < 10) return STANDARD_BUCKETS;

  const median = Math.round(areas[Math.floor(areas.length / 2)] / 10) * 10;
  const small = Math.round((median * 0.75) / 10) * 10;
  const large = Math.round((median * 1.3) / 10) * 10;

  return [
    {
      label: `~${small} מ"ר`,
      targetArea: small,
      minArea: Math.round(small * 0.85),
      maxArea: Math.round(small * 1.15),
    },
    {
      label: `~${median} מ"ר`,
      targetArea: median,
      minArea: Math.round(median * 0.88),
      maxArea: Math.round(median * 1.15),
    },
    {
      label: `~${large} מ"ר`,
      targetArea: large,
      minArea: Math.round(large * 0.85),
      maxArea: Math.round(large * 1.2),
    },
  ];
}

// ── Sample builders ──────────────────────────────────────────────

/**
 * Build an aggregated sample (≥2 deals).
 * Single-deal scenarios should use buildSingleSampleFromDeal instead.
 * Returns null only when 0 deals or all are filtered as outliers.
 */
function buildAggregatedSample(
  deals: NadlanDeal[]
): AggregatedSample | null {
  if (deals.length < 2) return null;

  const prices = deals.map(pricePerSqm).filter((p): p is number => p !== null);
  const cleanPrices = removeOutliers(prices);

  let threshold: ThresholdValue | null = null;
  for (const t of THRESHOLDS) {
    if (cleanPrices.length >= t && t >= 2) {
      threshold = t;
      break;
    }
  }
  if (threshold === null) return null;

  const cleanTotals = removeOutliers(deals.map((d) => d.dealAmount));
  const cleanAreas = removeOutliers(
    deals.map((d) => d.assetArea!).filter((a) => a > 0)
  );

  return {
    type: "aggregated",
    count: cleanPrices.length,
    threshold,
    avgPricePerSqm: Math.round(avgOfArray(cleanPrices)!),
    avgTotalPrice: Math.round(avgOfArray(cleanTotals)!),
    avgArea: Math.round(avgOfArray(cleanAreas)!),
  };
}

/**
 * Compute price/sqm sanity bounds for single-deal samples.
 * Strategy:
 *   1. Prefer bucket-specific distribution (≥5 deals) — tight bounds.
 *   2. Fall back to ALL deals on the street (any size) — wider but reliable.
 *   3. Last resort: global validity range.
 * Bounds: mean ± max(2σ, 50%) to allow legitimate variation but exclude
 * obvious data entry errors (e.g., ₪2,884/sqm in a ₪20K/sqm street).
 */
function priceSanityBounds(
  streetDeals: NadlanDeal[],
  bucketMin: number,
  bucketMax: number
): [number, number] {
  const bucketPrices = streetDeals
    .filter(
      (d) =>
        d.assetArea !== null &&
        d.assetArea >= bucketMin &&
        d.assetArea <= bucketMax
    )
    .map(pricePerSqm)
    .filter((p): p is number => p !== null);

  let prices: number[];
  let marginFactor: number;
  if (bucketPrices.length >= 5) {
    prices = bucketPrices;
    marginFactor = 0.4; // tighter bounds when bucket has data
  } else {
    // Fall back to entire street (any size)
    const allStreetPrices = streetDeals
      .map(pricePerSqm)
      .filter((p): p is number => p !== null);
    if (allStreetPrices.length < 5) return [2000, 200000];
    prices = allStreetPrices;
    marginFactor = 0.5; // a bit wider since we're crossing sizes
  }

  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  const std = Math.sqrt(
    prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length
  );
  const margin = Math.max(2 * std, mean * marginFactor);
  return [Math.max(2000, mean - margin), Math.min(200000, mean + margin)];
}

/**
 * Find a single matching deal — last-resort fallback so the cell is never empty.
 * Progressive relaxation:
 *   1. Same street, bucket-matching area, target year, within 3 blocks
 *   2. Same street, area within ±15% of bucket target, target year (any house num)
 *   3. Same street, area within ±15% of bucket target, year ±1 (closest year)
 *   4. Returns null only if even step 3 finds nothing
 */
function findSingleSample(
  streetDeals: NadlanDeal[],
  allDeals: NadlanDeal[],
  refStreet: string,
  refHouseNum: number | null,
  bucketMin: number,
  bucketMax: number,
  bucketTargetArea: number,
  year: number
): SingleSample | null {
  const [loBound, hiBound] = priceSanityBounds(streetDeals, bucketMin, bucketMax);

  const isSanePrice = (d: NadlanDeal): boolean => {
    const ppsm = pricePerSqm(d);
    return ppsm !== null && ppsm >= loBound && ppsm <= hiBound;
  };

  const sameStreet = allDeals.filter((d) => d.streetNameHeb === refStreet);

  // ── Step 1: Strict — bucket + year + 3-block rule ─────────────────
  const strictCandidates = sameStreet.filter((d) => {
    if (d.assetArea === null || d.assetArea < bucketMin || d.assetArea > bucketMax) return false;
    if (dealYear(d) !== year) return false;
    if (!isSanePrice(d)) return false;
    if (refHouseNum !== null && d.houseNum !== null) {
      return Math.abs(d.houseNum - refHouseNum) <= 3;
    }
    return true;
  });
  const strictBest = pickClosestHouseNum(strictCandidates, refHouseNum);
  if (strictBest) return toSingleSample(strictBest, refStreet, refHouseNum);

  // ── Step 2: Relaxed area ±15% around bucket target, same year ────
  const tolMin = Math.round(bucketTargetArea * (1 - SAME_SIZE_TOLERANCE));
  const tolMax = Math.round(bucketTargetArea * (1 + SAME_SIZE_TOLERANCE));
  const relaxedCandidates = sameStreet.filter((d) => {
    if (d.assetArea === null || d.assetArea < tolMin || d.assetArea > tolMax) return false;
    if (dealYear(d) !== year) return false;
    return isSanePrice(d);
  });
  const relaxedBest = pickClosestHouseNum(relaxedCandidates, refHouseNum);
  if (relaxedBest) return toSingleSample(relaxedBest, refStreet, refHouseNum);

  // ── Step 3: Same area tolerance, nearest year (±1) ───────────────
  const nearYearCandidates = sameStreet.filter((d) => {
    if (d.assetArea === null || d.assetArea < tolMin || d.assetArea > tolMax) return false;
    const diff = Math.abs(dealYear(d) - year);
    if (diff > 1) return false;
    return isSanePrice(d);
  });
  const nearYearBest = pickClosestHouseNum(nearYearCandidates, refHouseNum);
  if (nearYearBest) return toSingleSample(nearYearBest, refStreet, refHouseNum);

  return null;
}

/** Pick the deal with house number closest to the reference. */
function pickClosestHouseNum(
  deals: NadlanDeal[],
  refHouseNum: number | null
): NadlanDeal | null {
  if (deals.length === 0) return null;
  if (refHouseNum === null) return deals[0];

  let best: NadlanDeal | null = null;
  let bestDistance = Infinity;
  for (const d of deals) {
    const distance = d.houseNum !== null ? Math.abs(d.houseNum - refHouseNum) : 999;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = d;
    }
  }
  return best;
}

function toSingleSample(deal: NadlanDeal, refStreet: string, refHouseNum: number | null): SingleSample | null {
  const ppsm = pricePerSqm(deal);
  if (ppsm === null) return null;
  let blocksAway = 0;
  if (refHouseNum !== null && deal.houseNum !== null) {
    blocksAway = Math.abs(deal.houseNum - refHouseNum);
  }
  return {
    type: "single",
    pricePerSqm: Math.round(ppsm),
    totalPrice: deal.dealAmount,
    area: deal.assetArea!,
    houseNum: deal.houseNum,
    streetName: deal.streetNameHeb || refStreet,
    blocksAway,
    dealDate: deal.dealDate,
  };
}

// ── Build Comparisons ────────────────────────────────────────────

/**
 * For a given street, build size-bucket × period results.
 * Each cell uses the fallback hierarchy: 15 → 10 → 5 → single deal.
 */
function buildStreetComparison(
  streetName: string,
  streetDeals: NadlanDeal[],
  allDeals: NadlanDeal[],
  bucketsDef: { label: string; targetArea: number; minArea: number; maxArea: number }[],
  periodYears: { current: number; minus3: number; minus5: number }
): StreetComparison | null {
  // Reference house num for "within 3 blocks": most common house num on the street
  const houseNumCounts = new Map<number, number>();
  for (const d of streetDeals) {
    if (d.houseNum !== null) {
      houseNumCounts.set(d.houseNum, (houseNumCounts.get(d.houseNum) || 0) + 1);
    }
  }
  const refHouseNum =
    [...houseNumCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const sizeBuckets: SizeBucketResult[] = [];
  let hasAnyData = false;

  for (const bucketDef of bucketsDef) {
    const periods: PeriodData[] = [];

    for (const [periodKey, year] of [
      ["current" as const, periodYears.current],
      ["minus3" as const, periodYears.minus3],
      ["minus5" as const, periodYears.minus5],
    ]) {
      // Step 1: try to aggregate by street + bucket + year
      const streetBucketYearDeals = streetDeals.filter(
        (d) =>
          d.assetArea !== null &&
          d.assetArea >= bucketDef.minArea &&
          d.assetArea <= bucketDef.maxArea &&
          dealYear(d) === year
      );

      let sample: DealSample | null = buildAggregatedSample(streetBucketYearDeals);

      // Step 2: if no aggregated sample, try single-deal fallback with progressive relaxation
      if (!sample) {
        sample = findSingleSample(
          streetDeals,
          allDeals,
          streetName,
          refHouseNum,
          bucketDef.minArea,
          bucketDef.maxArea,
          bucketDef.targetArea,
          year
        );
      }

      if (sample) hasAnyData = true;
      periods.push({ period: periodKey, year, sample });
    }

    // Only include bucket if it has at least one period with data
    if (periods.some((p) => p.sample !== null)) {
      sizeBuckets.push({
        label: bucketDef.label,
        targetArea: bucketDef.targetArea,
        minArea: bucketDef.minArea,
        maxArea: bucketDef.maxArea,
        periods,
      });
    }
  }

  if (!hasAnyData || sizeBuckets.length === 0) return null;

  return {
    streetName,
    totalDeals: streetDeals.length,
    sizeBuckets,
  };
}

/**
 * For a neighborhood: find top streets and build per-street comparisons.
 */
function buildNeighborhoodComparison(
  neighborhood: string,
  nhDeals: NadlanDeal[],
  bucketsDef: { label: string; targetArea: number; minArea: number; maxArea: number }[],
  periodYears: { current: number; minus3: number; minus5: number }
): NeighborhoodComparison | null {
  // Group by street — deals with no street name are bucketed under the placeholder.
  const byStreet = new Map<string, NadlanDeal[]>();
  for (const d of nhDeals) {
    const street = d.streetNameHeb || "(ללא רחוב)";
    if (!byStreet.has(street)) byStreet.set(street, []);
    byStreet.get(street)!.push(d);
  }

  // Sort streets by deal count, pick top candidates
  const sortedStreets = [...byStreet.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);

  const streetResults: StreetComparison[] = [];
  for (const [streetName, streetDeals] of sortedStreets) {
    if (streetResults.length >= 2) break; // up to 2 streets per neighborhood

    const cmp = buildStreetComparison(
      streetName,
      streetDeals,
      nhDeals,
      bucketsDef,
      periodYears
    );
    if (cmp) streetResults.push(cmp);
  }

  if (streetResults.length === 0) return null;

  // Average deals per year (across 6 years window)
  const years = new Set(nhDeals.map(dealYear));
  const dealsPerYearAvg =
    years.size > 0 ? Math.round(nhDeals.length / years.size) : nhDeals.length;

  return {
    neighborhood,
    totalDeals: nhDeals.length,
    dealsPerYearAvg,
    streets: streetResults,
  };
}

// ── Main Export ──────────────────────────────────────────────────

export async function getCityDealsData(
  cityName: string
): Promise<CityDealsData> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  // Tentative: use prev year as "current" — Tax Authority data lags ~2-3 months
  // and a current year early on rarely has enough volume. We'll refine after fetching.
  let effectiveCurrentYear = currentYear - 1;

  // Initial period years (refined later based on actual data volume)
  let periodYears = {
    current: effectiveCurrentYear,
    minus3: effectiveCurrentYear - 3,
    minus5: effectiveCurrentYear - 5,
  };

  // Always fetch a 6-year window starting at the oldest period
  const startYear = effectiveCurrentYear - 5;
  const startDate = `${startYear}-01`;
  const endDate = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;

  const emptyResult: CityDealsData = {
    cityName,
    lastUpdated: now.toISOString(),
    neighborhoods: [],
    totalDealsAnalyzed: 0,
    periodYears,
    townCharacter: "יישוב קטן",
  };

  // Step 1: Find city center
  const coords = await searchCityCoordinates(cityName);
  if (!coords) return emptyResult;
  await sleep(REQUEST_DELAY_MS);

  // Step 2: Find polygons in wide radius
  const polygons = await getDealsByRadius(coords.x, coords.y, 7000);
  if (!polygons || polygons.length === 0) return emptyResult;
  await sleep(REQUEST_DELAY_MS);

  const sortedPolygons = [...polygons]
    .filter((p) => parseInt(p.dealscount) > 0)
    .sort((a, b) => parseInt(b.dealscount) - parseInt(a.dealscount));

  if (sortedPolygons.length === 0) return emptyResult;

  // Step 3: Spread picks for diversity
  const step = Math.max(1, Math.floor(sortedPolygons.length / 20));
  const pickOrder: typeof sortedPolygons = [];
  for (let i = 0; i < sortedPolygons.length && pickOrder.length < 30; i += step) {
    pickOrder.push(sortedPolygons[i]);
  }
  for (const p of sortedPolygons) {
    if (pickOrder.length >= 30) break;
    if (!pickOrder.includes(p)) pickOrder.push(p);
  }

  const allDeals: NadlanDeal[] = [];
  const seenDealKeys = new Set<string>();
  const fetchedNeighborhoods = new Set<string>();
  let fetchCount = 0;
  const MAX_FETCHES = 12;

  // 2 time windows per polygon to overcome 2000-result limit
  const midYear = startYear + 3;
  const midDate = `${midYear}-01`;

  for (const polygon of pickOrder) {
    if (fetchCount >= MAX_FETCHES) break;

    try {
      const recentResult = await getNeighborhoodDeals(
        polygon.polygon_id,
        midDate,
        endDate,
        2000
      );
      if (!recentResult.data || recentResult.data.length === 0) continue;

      const nhName = recentResult.data[0]?.neighborhood;
      if (nhName && fetchedNeighborhoods.has(nhName)) continue;
      if (nhName) fetchedNeighborhoods.add(nhName);

      for (const deal of recentResult.data) {
        const dealKey = `${deal.dealId || ""}-${deal.dealDate}-${deal.dealAmount}-${deal.assetArea}`;
        if (!seenDealKeys.has(dealKey)) {
          seenDealKeys.add(dealKey);
          allDeals.push(deal);
        }
      }

      await sleep(REQUEST_DELAY_MS);

      const olderResult = await getNeighborhoodDeals(
        polygon.polygon_id,
        startDate,
        midDate,
        2000
      );
      if (olderResult.data) {
        for (const deal of olderResult.data) {
          const dealKey = `${deal.dealId || ""}-${deal.dealDate}-${deal.dealAmount}-${deal.assetArea}`;
          if (!seenDealKeys.has(dealKey)) {
            seenDealKeys.add(dealKey);
            allDeals.push(deal);
          }
        }
      }

      fetchCount++;
      await sleep(REQUEST_DELAY_MS);
    } catch {
      // skip failed polygon
    }
  }

  // Step 4: Filter valid deals
  const validDeals = allDeals.filter(isValidDeal);
  if (validDeals.length === 0)
    return { ...emptyResult, totalDealsAnalyzed: 0 };

  // Step 5: Detect town character & size buckets
  const townCharacter = detectTownCharacter(validDeals);
  const bucketsDef = getSizeBuckets(validDeals, townCharacter);

  // Step 5b: Refine "current year" — pick the most recent year with enough volume.
  // Rule: at least 60% of the prior year's volume (ensures the year isn't a stub),
  // AND a minimum absolute floor of 30 deals.
  const dealsByYear = new Map<number, number>();
  for (const d of validDeals) {
    const y = dealYear(d);
    dealsByYear.set(y, (dealsByYear.get(y) || 0) + 1);
  }
  const yearCandidates = [currentYear, currentYear - 1, currentYear - 2];
  for (const y of yearCandidates) {
    const cnt = dealsByYear.get(y) || 0;
    const prevCnt = dealsByYear.get(y - 1) || 0;
    const enoughAbs = cnt >= 30;
    const enoughRel = prevCnt === 0 ? cnt >= 50 : cnt >= prevCnt * 0.6;
    if (enoughAbs && enoughRel) {
      effectiveCurrentYear = y;
      break;
    }
  }
  periodYears = {
    current: effectiveCurrentYear,
    minus3: effectiveCurrentYear - 3,
    minus5: effectiveCurrentYear - 5,
  };

  // Step 6: Group by neighborhood
  const byNeighborhood = new Map<string, NadlanDeal[]>();
  for (const d of validDeals) {
    const nh = d.neighborhood;
    if (!nh) continue;
    if (!byNeighborhood.has(nh)) byNeighborhood.set(nh, []);
    byNeighborhood.get(nh)!.push(d);
  }

  // Step 7: Filter to neighborhoods with ≥15 deals/year on average (over 6-year window)
  // Then take top 3 by total deals
  const yearsCount = new Set(validDeals.map(dealYear)).size || 1;
  const qualifyingNeighborhoods = [...byNeighborhood.entries()]
    .filter(([, deals]) => deals.length / yearsCount >= 15)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3);

  // Step 8: Build per-neighborhood comparisons
  const neighborhoodResults: NeighborhoodComparison[] = [];
  for (const [nhName, nhDeals] of qualifyingNeighborhoods) {
    const cmp = buildNeighborhoodComparison(
      nhName,
      nhDeals,
      bucketsDef,
      periodYears
    );
    if (cmp) neighborhoodResults.push(cmp);
  }

  // Step 9: Fallback — if no neighborhoods qualify, use top-by-volume neighborhoods (regardless of /year rule)
  if (neighborhoodResults.length === 0) {
    const topByVolume = [...byNeighborhood.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3);
    for (const [nhName, nhDeals] of topByVolume) {
      const cmp = buildNeighborhoodComparison(
        nhName,
        nhDeals,
        bucketsDef,
        periodYears
      );
      if (cmp) neighborhoodResults.push(cmp);
    }
  }

  // Step 10: Last-resort — if no neighborhoods qualify, treat the whole town as one
  // "neighborhood" so we still show *something* as long as ≥1 valid deal exists.
  if (neighborhoodResults.length === 0 && validDeals.length >= 1) {
    const cmp = buildNeighborhoodComparison(
      "כל היישוב",
      validDeals,
      bucketsDef,
      periodYears
    );
    if (cmp) neighborhoodResults.push(cmp);
  }

  // Step 11: ULTIMATE fallback — if STILL nothing, switch to adaptive years
  // (pick the 3 years with the most deals, regardless of the standard "now/-3/-5" pattern).
  // This handles tiny towns where the data exists but in unexpected years.
  if (neighborhoodResults.length === 0 && validDeals.length >= 1) {
    const yearCounts = new Map<number, number>();
    for (const d of validDeals) {
      const y = dealYear(d);
      yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
    }
    const topYears = [...yearCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([y]) => y)
      .sort((a, b) => b - a);

    // Pad if fewer than 3 distinct years
    while (topYears.length < 3) topYears.push(topYears[topYears.length - 1] - 1);

    const adaptivePeriods = {
      current: topYears[0],
      minus3: topYears[1],
      minus5: topYears[2],
    };

    // Try city-wide with adaptive years
    const cmp = buildNeighborhoodComparison(
      "כל היישוב",
      validDeals,
      bucketsDef,
      adaptivePeriods
    );
    if (cmp) {
      neighborhoodResults.push(cmp);
      // Update returned periodYears to reflect the adaptive choice
      periodYears = adaptivePeriods;
    }
  }

  return {
    cityName,
    lastUpdated: now.toISOString(),
    neighborhoods: neighborhoodResults,
    totalDealsAnalyzed: validDeals.length,
    periodYears,
    townCharacter,
  };
}
