/**
 * Everything the STREET page and the ADDRESS (building) page load — the two
 * levels below the neighbourhood, and the ones a reader researching one flat
 * actually needs.
 *
 * WHY THESE PAGES EXIST. The site could say a neighbourhood is 12% above its
 * city; it could not say what the building on the corner sold for last
 * spring, nor that the same 4-room flat on the third floor changed hands
 * twice. Those are the facts that make the numbers believable — and they are
 * exactly what a search for "רוטשילד 16 עסקאות" is asking for.
 *
 * STREET SPELLINGS ARE FOLDED, NOT GUESSED. The Tax Authority writes the same
 * street three ways; lib/addressKey.normStreet is the one key. The page loads
 * the city's distinct spellings once (cached) and keeps every one that folds
 * to the requested key — so a URL in any spelling lands on the union of all
 * of them, and redirects to the most common one as the canonical address.
 *
 * NO COORDINATES ARE NEEDED HERE. The map beside these pages is the pin
 * layer, fetched by the browser; the pages themselves are built from
 * addresses alone, which is why they can ship the day the address campaign
 * lands, before any geocoding.
 */
import { prisma } from "./db";
import { cachedMarket } from "./cache";
import { getRuleNum } from "./systemRules";
import { normHouse, normStreet } from "./addressKey";
import { pickModalHood } from "./searchIndex";
import { loadNeighborhoodCells, neighborhoodSummary } from "./neighborhoods";
import {
  apartmentThreads, bucketBuildings, detectProject, medianOf, modeOf, pctVs, yearStats,
  type AddressDeal, type ApartmentThread, type BuildingRow, type YearStat,
} from "./buildingRules";

/* ───────────── shared loaders ───────────── */

/** joins the spellings into one cache-key string — a control char no street contains */
const SEP = "\u001f";

interface RawDeal {
  id: number; deal_date: string; deal_year: number; rooms: number | null; area: number | null;
  price: number | null; price_sqm: number | null; year_built: number | null; is_secondhand: number;
  floor: string | null; street: string | null; house_num: string | null; neighborhood: string | null; luxury: number | null;
}

const DEAL_COLS = `id, deal_date, deal_year, rooms, area, price, price_sqm, year_built, is_secondhand,
                   floor, street, house_num, neighborhood, COALESCE(luxury,0) luxury`;

function toDeal(r: RawDeal): AddressDeal {
  return {
    id: Number(r.id), dealDate: String(r.deal_date), dealYear: Number(r.deal_year),
    rooms: r.rooms == null ? null : Number(r.rooms), area: r.area == null ? null : Number(r.area),
    price: r.price == null ? null : Number(r.price), priceSqm: r.price_sqm == null ? null : Number(r.price_sqm),
    yearBuilt: r.year_built == null || Number(r.year_built) === 0 ? null : Number(r.year_built),
    isSecondHand: !!Number(r.is_secondhand), floor: r.floor == null ? null : String(r.floor),
    street: r.street, houseNum: r.house_num == null ? null : String(r.house_num),
    neighborhood: r.neighborhood, luxury: !!Number(r.luxury),
  };
}

/** Every distinct street spelling in a city, with its deal count. */
async function loadCityStreetsUncached(cityName: string): Promise<Array<{ street: string; n: number }>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ street: string; n: number }>>(
      `SELECT street, COUNT(*) n FROM nadlan_transactions
        WHERE city_name = ? AND street IS NOT NULL AND street != '' AND COALESCE(excluded,0) = 0
        GROUP BY street`,
      cityName
    );
    return rows.map((r) => ({ street: String(r.street), n: Number(r.n) }));
  } catch { return []; }
}
export const loadCityStreets = cachedMarket(loadCityStreetsUncached, ["city-streets"]);

/**
 * The spellings that fold to the requested street, most common first — or
 * an empty list when the city has no such street.
 */
export async function resolveStreet(cityName: string, requested: string): Promise<{ canonical: string; spellings: string[]; n: number } | null> {
  const key = normStreet(requested);
  if (!key) return null;
  const all = await loadCityStreets(cityName);
  const hits = all.filter((s) => normStreet(s.street) === key).sort((a, b) => b.n - a.n);
  if (!hits.length) return null;
  return { canonical: hits[0].street, spellings: hits.map((h) => h.street), n: hits.reduce((s, h) => s + h.n, 0) };
}

async function loadStreetDealsUncached(cityName: string, spellingsKey: string): Promise<AddressDeal[]> {
  const spellings = spellingsKey.split(SEP).filter(Boolean);
  if (!spellings.length) return [];
  try {
    const rows = await prisma.$queryRawUnsafe<RawDeal[]>(
      `SELECT ${DEAL_COLS} FROM nadlan_transactions
        WHERE city_name = ? AND COALESCE(excluded,0) = 0 AND street IN (${spellings.map(() => "?").join(",")})
        ORDER BY deal_date DESC`,
      cityName, ...spellings
    );
    return rows.map(toDeal);
  } catch { return []; }
}
const loadStreetDeals = cachedMarket(loadStreetDealsUncached, ["street-deals"]);

/* ───────────── the street page ───────────── */

export interface StreetPageData {
  cityName: string;
  /** canonical (most common) spelling — the URL key */
  street: string;
  spellings: string[];
  /** modal neighbourhood, when one holds ≥70% of the street's classified deals */
  hood: string | null;
  hoodShare: number | null;
  total: number;
  secondhandTotal: number;
  years: [number, number] | null;
  yearStatsSh: YearStat[];
  yearStatsAll: YearStat[];
  /** headline: latest year with enough second-hand deals */
  refYear: number | null;
  sqm: number | null;
  vsHoodPct: number | null;
  vsCityPct: number | null;
  buildings: BuildingRow[];
  recent: AddressDeal[];
  addressCoverage: number;
}

export async function loadStreetPage(cityName: string, requested: string): Promise<StreetPageData | null> {
  const resolved = await resolveStreet(cityName, requested);
  if (!resolved) return null;
  const deals = await loadStreetDeals(cityName, resolved.spellings.join(SEP));
  if (!deals.length) return null;

  const hoodCounts = new Map<string, number>();
  for (const d of deals) if (d.neighborhood) hoodCounts.set(d.neighborhood, (hoodCounts.get(d.neighborhood) ?? 0) + 1);
  const modal = pickModalHood(hoodCounts, { minN: 3 });
  const classified = [...hoodCounts.values()].reduce((s, n) => s + n, 0);

  const sh = deals.filter((d) => d.isSecondHand);
  const statsSh = yearStats(sh);
  const statsAll = yearStats(deals);
  const minN = Math.max(3, Math.round(getRuleNum("neighborhood_min_deals") / 2));
  const usable = statsSh.filter((s) => s.n >= minN && s.medianSqm);
  const ref = usable.at(-1) ?? null;

  let vsHoodPct: number | null = null, vsCityPct: number | null = null;
  if (ref) {
    const summary = await neighborhoodSummary(cityName, { scope: "secondhand", years: 3 });
    vsCityPct = pctVs(ref.medianSqm, summary.citySqm);
    if (modal) {
      const cells = await loadNeighborhoodCells(cityName, "secondhand");
      const cell = cells.find((c) => c.neighborhood === modal.hood && c.year === ref.year);
      vsHoodPct = pctVs(ref.medianSqm, cell?.sqm ?? null);
    }
  }

  const years = deals.length ? [Math.min(...deals.map((d) => d.dealYear)), Math.max(...deals.map((d) => d.dealYear))] as [number, number] : null;
  return {
    cityName, street: resolved.canonical, spellings: resolved.spellings,
    hood: modal?.hood ?? null, hoodShare: modal && classified ? (hoodCounts.get(modal.hood) ?? 0) / classified : null,
    total: deals.length, secondhandTotal: sh.length, years,
    yearStatsSh: statsSh, yearStatsAll: statsAll,
    refYear: ref?.year ?? null, sqm: ref?.medianSqm ?? null, vsHoodPct, vsCityPct,
    buildings: bucketBuildings(deals),
    recent: deals.slice(0, 15),
    addressCoverage: deals.filter((d) => normHouse(d.houseNum).primary).length / deals.length,
  };
}

/* ───────────── the address (building) page ───────────── */

export interface BuildingPageData {
  cityName: string;
  street: string;
  house: string;
  /** most common raw spelling of the number */
  houseLabel: string;
  hood: string | null;
  deals: AddressDeal[];
  yearBuilt: number | null;
  project: ReturnType<typeof detectProject>;
  threads: ApartmentThread[];
  years: [number, number] | null;
  medianSqm: number | null;
  /** ₪/m² of the building's second-hand deals vs the hood's, per deal year — the "for HERE" comparison */
  perDealVsHood: Array<{ id: number; vsHoodPct: number | null }>;
  floors: number;
  sizes: [number, number] | null;
}

export async function loadBuildingPage(cityName: string, requestedStreet: string, requestedHouse: string): Promise<BuildingPageData | null> {
  const resolved = await resolveStreet(cityName, requestedStreet);
  if (!resolved) return null;
  const house = normHouse(requestedHouse).primary;
  if (!house) return null;
  const all = await loadStreetDeals(cityName, resolved.spellings.join(SEP));
  const deals = all.filter((d) => {
    const h = normHouse(d.houseNum);
    return h.primary === house || h.alts.includes(house);
  });
  if (!deals.length) return null;

  const labels = new Map<string, number>();
  for (const d of deals) { const l = String(d.houseNum ?? "").trim(); labels.set(l, (labels.get(l) ?? 0) + 1); }
  const houseLabel = [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? house;

  const hood = modeOf(deals.map((d) => d.neighborhood));
  const project = detectProject(deals, {
    minDeals: getRuleNum("project_detect_min_deals"),
    months: getRuleNum("project_detect_months"),
  });

  // per-deal comparison to the neighbourhood's second-hand median of that year
  let perDealVsHood: BuildingPageData["perDealVsHood"] = deals.map((d) => ({ id: d.id, vsHoodPct: null }));
  if (hood) {
    const cells = await loadNeighborhoodCells(cityName, "secondhand");
    perDealVsHood = deals.map((d) => {
      const cell = cells.find((c) => c.neighborhood === hood && c.year === d.dealYear);
      return { id: d.id, vsHoodPct: d.luxury ? null : pctVs(d.priceSqm, cell?.sqm ?? null) };
    });
  }

  const areas = deals.map((d) => d.area).filter((a): a is number => a != null && a > 0);
  return {
    cityName, street: resolved.canonical, house, houseLabel, hood, deals,
    yearBuilt: modeOf(deals.map((d) => d.yearBuilt)),
    project, threads: apartmentThreads(deals),
    years: [Math.min(...deals.map((d) => d.dealYear)), Math.max(...deals.map((d) => d.dealYear))],
    medianSqm: medianOf(deals.filter((d) => !d.luxury).map((d) => d.priceSqm)),
    perDealVsHood,
    floors: new Set(deals.map((d) => (d.floor ?? "").trim()).filter(Boolean)).size,
    sizes: areas.length ? [Math.min(...areas), Math.max(...areas)] : null,
  };
}
