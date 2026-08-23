import { describe, it, expect } from "vitest";
import { gradeTrend } from "@/lib/confidence";
import { canonicalCityName, normalizeCity, sameCity } from "@/lib/cityAliases";
import { toVisualRtl } from "@/lib/rtlVisual";
import { PIPELINE, STAGE_IDS, stagesFrom, mutationStages } from "@/lib/pipeline";
import { dwellingsFile, dwellingsFor, nationalPersonsPerDwelling } from "@/lib/dwellings";
import { pickLastUsableYear, isClassifiable, classifyDeal } from "@/lib/nadlanTransactionSeries";
import { fromToText } from "@/components/FromTo";
import { citySearch } from "@/lib/citySearch";
import { labelForPath, sectionLabel } from "@/lib/pageLabels";
import { reconcile, defaultOrder, PAGE_KEYS, PAGE_SECTIONS } from "@/lib/pageSections";
import { priceBins, binOf, buildCityMap, type CityMapGeometry } from "@/lib/cityMap";
import { normHoodKey } from "@/lib/hoodKey";
import { project, makeProjector, simplify, simplifyRing, decimate, MAX_SIMPLIFY_POINTS, lineLength, ringCentroid, emptyBBox, extendBBox, bboxIsEmpty, VIEW_SIZE, type LonLat, type Point } from "@/lib/geo";
import { pctChange, type UsagePayload } from "@/lib/usagePayload";
import { buildUsageInsights, rankInsights, type Insight } from "@/lib/usageInsights";
import { selectMovers, explainEmpty, defaultMoversQuery, type GainSeries } from "@/lib/moversBoard";
import { __isEmptyCollection } from "@/lib/cache";
import { growthOverSpan } from "@/lib/cityTransactionPrices";

/**
 * Every case here is a bug this codebase actually shipped or nearly shipped.
 * A test that asserts an obvious property teaches nothing; these pin down the
 * decisions that were argued over, so the next person to "simplify" one of
 * them finds out immediately rather than from a wrong number on a live page.
 */

describe("gradeTrend", () => {
  it("hides a change whose baseline is zero or negative", () => {
    // Dividing by a zero baseline yields Infinity, which formats as a
    // confident-looking "+Infinity%" rather than an error.
    expect(gradeTrend({ from: 0, to: 100 }).displayable).toBe(false);
    expect(gradeTrend({ from: -5, to: 100 }).displayable).toBe(false);
  });

  it("hides rather than guesses when an endpoint is missing", () => {
    // The alternative — silently substituting a nearby year — is how a page
    // ends up labelled 2020→2025 while measuring 2021→2025.
    expect(gradeTrend({ from: null, to: 100 }).level).toBe("hidden");
    expect(gradeTrend({ from: 100, to: null }).level).toBe("hidden");
  });

  it("computes the percentage in the direction the label claims", () => {
    const up = gradeTrend({ from: 100, to: 150, fromN: 50, toN: 50 });
    expect(up.value).toBeCloseTo(50);
    const down = gradeTrend({ from: 150, to: 100, fromN: 50, toN: 50 });
    expect(down.value).toBeCloseTo(-33.333, 2);
  });

  it("grades by the WEAKER endpoint, not the average of the two", () => {
    // 500 deals at one end cannot vouch for 3 at the other.
    expect(gradeTrend({ from: 100, to: 120, fromN: 500, toN: 3 }).level).toBe("hidden");
  });

  it("flags an implausible change for review instead of hiding it", () => {
    // Hiding it would lose the signal; the outlier IS the finding.
    const r = gradeTrend({ from: 100, to: 1000, fromN: 500, toN: 500 });
    expect(r.displayable).toBe(true);
    expect(r.level).toBe("needs_review");
  });
});

describe("city naming", () => {
  it("folds a merged settlement onto its canonical name", () => {
    expect(canonicalCityName("מכבים רעות")).toBe("מודיעין-מכבים-רעות");
  });

  it("leaves an ordinary city untouched", () => {
    expect(canonicalCityName("חיפה")).toBe("חיפה");
  });

  it("treats spelling variants as the same place", () => {
    expect(sameCity("תל אביב-יפו", "תל אביב יפו")).toBe(true);
    expect(sameCity("הרצלייה", "הרצליה")).toBe(true);
    expect(sameCity("פתח תקווה", "פתח תקוה")).toBe(true);
  });

  it("does not collapse two genuinely different cities", () => {
    expect(sameCity("רמת גן", "רמת השרון")).toBe(false);
    expect(normalizeCity("נס ציונה")).not.toBe(normalizeCity("ציונה"));
  });

  it("never matches when either side is missing", () => {
    expect(sameCity(null, "חיפה")).toBe(false);
    expect(sameCity("", "")).toBe(false);
  });
});

describe("city search", () => {
  const cities = [
    { city_name: "קריית אתא" },
    { city_name: "קריית ביאליק" },
    { city_name: "קריית ים" },
    { city_name: "הרצליה" },
    { city_name: "באר שבע" },
  ];

  it("finds Kiryat cities when the yod spelling differs", () => {
    expect(citySearch(cities, "קרית").map((h) => h.item.city_name)).toContain("קריית אתא");
    expect(citySearch(cities, "קרית ים")[0].item.city_name).toBe("קריית ים");
  });

  /**
   * The operator's rule (8/2026): typing either spelling must offer EVERY
   * Kiryat, whichever spelling the name happens to be stored under. The city
   * names themselves are deliberately not renamed, so this equivalence is the
   * only thing standing between "קרית" and an empty dropdown — which is
   * exactly what /cities and /compare showed until they were routed through
   * this engine. Pinned in both directions and on a mixed-spelling list so a
   * future tweak to normalizeCitySearch cannot quietly undo it.
   */
  it("returns the same Kiryat set for both spellings, whichever way they are stored", () => {
    const mixed = [
      { city_name: "קריית אתא" },   // stored with the double yod
      { city_name: "קרית אונו" },   // stored without it
      { city_name: "קריית ים" },
      { city_name: "הרצליה" },
    ];
    const names = (q: string) => citySearch(mixed, q, 10).map((h) => h.item.city_name).sort();

    expect(names("קרית")).toEqual(["קריית אתא", "קריית ים", "קרית אונו"].sort());
    expect(names("קריית")).toEqual(names("קרית"));
    expect(names("קרית א")).toEqual(names("קריית א"));
    // and a full name typed the "wrong" way still lands on the exact city
    expect(citySearch(mixed, "קריית אונו")[0].item.city_name).toBe("קרית אונו");
    expect(citySearch(mixed, "קרית אתא")[0].item.city_name).toBe("קריית אתא");
  });

  it("translates accidental English-keyboard Hebrew", () => {
    expect(citySearch(cities, "ctr", 1)[0].item.city_name).toBe("באר שבע");
  });

  it("offers a close typo instead of a dead end", () => {
    expect(citySearch(cities, "הרצלה", 1)[0].item.city_name).toBe("הרצליה");
  });
});

describe("toVisualRtl (OG card text ordering)", () => {
  // satori has no bidi algorithm, so the string must arrive pre-ordered.
  it("keeps a number readable inside Hebrew text", () => {
    // The first version reversed the digits too and produced "345,12".
    expect(toVisualRtl("מחיר 12,345 שקל")).toContain("12,345");
  });

  it("leaves pure latin/numeric text alone", () => {
    expect(toVisualRtl("2026")).toBe("2026");
  });

  it("reverses the Hebrew run", () => {
    expect(toVisualRtl("חיפה")).toBe("הפיח");
  });
});

describe("pipeline order", () => {
  it("has unique, stable stage ids", () => {
    expect(new Set(STAGE_IDS).size).toBe(STAGE_IDS.length);
  });

  it("classifies before flagging luxury", () => {
    // flag-luxury reads is_secondhand, which classify writes. README had these
    // the other way round, which silently graded luxury against the PREVIOUS
    // run's classification.
    expect(STAGE_IDS.indexOf("classify")).toBeLessThan(STAGE_IDS.indexOf("luxury"));
  });

  it("aggregates only after every flag it reads has been written", () => {
    const agg = STAGE_IDS.indexOf("aggregate");
    for (const id of ["rooms", "secondhand", "classify", "dupes", "outliers", "luxury"]) {
      expect(STAGE_IDS.indexOf(id)).toBeLessThan(agg);
    }
  });

  it("runs every verification gate after the last mutation", () => {
    const lastMutation = Math.max(
      ...mutationStages().map((s) => STAGE_IDS.indexOf(s.id))
    );
    for (const s of PIPELINE.filter((x) => x.gate)) {
      expect(STAGE_IDS.indexOf(s.id)).toBeGreaterThan(lastMutation);
    }
  });

  it("resumes from a stage rather than silently running everything", () => {
    expect(stagesFrom("aggregate")[0].id).toBe("aggregate");
    expect(() => stagesFrom("no-such-stage")).toThrow();
    expect(stagesFrom().length).toBe(PIPELINE.length);
  });
});

describe("CBS dwelling stock 2025", () => {
  // The table was transcribed from a published image. Arithmetic is the only
  // check that can catch a mistyped digit, so it lives here rather than in a
  // one-off script that ran once and was deleted.
  it("reconciles every city's ratio with population ÷ dwellings", () => {
    const file = dwellingsFile()!;
    expect(file).toBeTruthy();
    for (const c of file.cities) {
      expect(Math.abs(c.population / c.dwellings - c.ratio)).toBeLessThan(0.006);
    }
  });

  it("sums to the published 50k+ totals", () => {
    const file = dwellingsFile()!;
    const d = file.cities.reduce((a, c) => a + c.dwellings, 0);
    const p = file.cities.reduce((a, c) => a + c.population, 0);
    expect(d).toBe(file.national.citiesOver50k.dwellings);
    // Two people out of ~6M: rounding inside the CBS table itself, not a typo.
    expect(Math.abs(p - file.national.citiesOver50k.population)).toBeLessThanOrEqual(5);
  });

  it("uses the published national ratio, not a mean of city ratios", () => {
    const file = dwellingsFile()!;
    const meanOfRatios = file.cities.reduce((a, c) => a + c.ratio, 0) / file.cities.length;
    expect(nationalPersonsPerDwelling()).toBe(3.27);
    // The two genuinely differ — which is why the distinction is worth a test.
    expect(Math.abs(meanOfRatios - 3.27)).toBeGreaterThan(0.1);
  });

  it("finds a city despite the publication's spelling", () => {
    // The table writes הרצלייה; the database stores הרצליה.
    expect(dwellingsFor("הרצליה")?.dwellings).toBe(42199);
    expect(dwellingsFor("תל אביב יפו")?.ratio).toBe(2.11);
    expect(dwellingsFor("עיר שלא קיימת")).toBeNull();
  });
});

describe("pickLastUsableYear", () => {
  // The site used to refuse the running year outright, which pinned every
  // headline to a year that gets staler daily — in cities already holding
  // hundreds of fresh deals. The rule below is what replaced that blanket
  // refusal, and its failure mode is a plausible-but-wrong year: nothing
  // crashes, the page just quietly compares against the wrong endpoint.
  const base = {
    years: [2023, 2024, 2025, 2026],
    partialYears: [2026],
    lastFullYear: 2025,
    minMonths: 4,
    minDeals: 10,
  };

  it("uses the running year when it has enough months AND enough deals", () => {
    expect(pickLastUsableYear({
      ...base, monthsOf: () => 7, headlineNOf: () => 40,
    })).toBe(2026);
  });

  it("refuses a single season, however many deals it holds", () => {
    // 400 deals in two months is a January–February market, not a year. The
    // months floor exists precisely because volume cannot substitute for it.
    expect(pickLastUsableYear({
      ...base, monthsOf: () => 2, headlineNOf: () => 400,
    })).toBe(2025);
  });

  it("refuses a thin sample, however many months it spans", () => {
    expect(pickLastUsableYear({
      ...base, monthsOf: () => 9, headlineNOf: () => 4,
    })).toBe(2025);
  });

  it("never lets a disqualified partial year hide an earlier full year", () => {
    expect(pickLastUsableYear({
      ...base, monthsOf: () => 1, headlineNOf: () => 0,
    })).toBe(2025);
  });

  it("falls back to the last full year when a city has no data at all", () => {
    expect(pickLastUsableYear({
      years: [], partialYears: [], lastFullYear: null,
      monthsOf: () => 0, headlineNOf: () => 0, minMonths: 4, minDeals: 10,
    })).toBeNull();
  });

  it("honours a raised admin threshold", () => {
    // The thresholds are admin rules, not constants. A report that reads the
    // rule and a site that hardcodes it is how the two start disagreeing.
    expect(pickLastUsableYear({
      ...base, minMonths: 8, monthsOf: () => 7, headlineNOf: () => 400,
    })).toBe(2025);
  });
});

describe("fromToText", () => {
  it("puts the current value first, then the arrow, then the old one", () => {
    // The whole bug: `${from} ← ${to}` renders correctly for "₪12,345" and
    // BACKWARDS for "₪0.67M", because the Latin M is a strong-LTR character
    // and bidi rule N1 flips the run. Order is fixed in code, not left to
    // whatever the formatter happened to append.
    expect(fromToText("₪0.39M", "₪0.67M")).toBe("₪0.67M ← ₪0.39M");
    expect(fromToText(2022, 2026)).toBe("2026 ← 2022");
  });
});

describe("labelForPath", () => {
  // The dashboard was printing raw paths at the one person who cannot read
  // them. Every case here is a shape that actually appears in the event log.
  it("names the fixed routes", () => {
    expect(labelForPath("/").label).toBe("עמוד הבית");
    expect(labelForPath("/cities").label).toBe("טבלת כל הערים");
  });

  it("decodes a city name out of the URL", () => {
    // This is what the log actually stores — a Hebrew name is percent-encoded
    // by the browser long before it reaches us.
    expect(labelForPath("/city/%D7%97%D7%99%D7%A4%D7%94").label).toBe("עמוד עיר — חיפה");
    expect(labelForPath("/city/חיפה").kind).toBe("city");
  });

  it("reads ranking and stat titles from the same dictionary the pages use", () => {
    expect(labelForPath("/rankings/highest-gain").label).toContain("עליית מחיר");
    expect(labelForPath("/stats/total-population").label).toContain("אוכלוסיית הערים");
  });

  it("falls back to the path rather than inventing a name", () => {
    // A guessed label is worse than a raw path: the path is visibly a path,
    // and a wrong-but-plausible name is read as fact.
    expect(labelForPath("/nope/whatever").label).toBe("/nope/whatever");
    expect(labelForPath("/rankings/does-not-exist").label).toBe("דירוג — does not exist");
  });

  it("normalises trailing slashes and query strings to one row", () => {
    // Otherwise "/cities", "/cities/" and "/cities?x=1" are three rows in the
    // table for one page, each with a third of the traffic.
    expect(labelForPath("/cities/").label).toBe(labelForPath("/cities").label);
    expect(labelForPath("/cities?sort=price").label).toBe(labelForPath("/cities").label);
  });

  it("survives a malformed escape instead of throwing", () => {
    // decodeURIComponent throws on "%E0"; an analytics label must never be
    // able to take down the panel that renders it.
    expect(() => labelForPath("/city/%E0%A4%A")).not.toThrow();
  });
});

describe("sectionLabel", () => {
  it("names a known section and passes an unknown one through", () => {
    expect(sectionLabel("dwelling-stock")).toBe("מלאי הדירות בעיר");
    expect(sectionLabel("brand-new-section")).toBe("brand-new-section");
  });
});

describe("classifyDeal", () => {
  // The rule the operator set (8/2026): only a build year classifies. This
  // test exists because the failure mode is silent — a deal classified from an
  // inferred flag produces a plausible series that the site describes as
  // "by build year", and nothing anywhere would disagree.
  const MIN_AGE = 4;

  it("splits on age once there is a build year", () => {
    expect(classifyDeal(2018, 2025, MIN_AGE)).toBe("secondhand");
    expect(classifyDeal(2024, 2025, MIN_AGE)).toBe("new");
    // exactly at the threshold counts as second-hand
    expect(classifyDeal(2021, 2025, MIN_AGE)).toBe("secondhand");
  });

  it("refuses to classify a deal with no build year", () => {
    expect(classifyDeal(null, 2025, MIN_AGE)).toBeNull();
    expect(classifyDeal(undefined, 2025, MIN_AGE)).toBeNull();
  });

  it("treats a published zero as unknown, not as the year 0", () => {
    // 0 is how the Tax Authority publishes "unknown" — 30% of Tirat Karmel,
    // 46% of Akko. Read as a year it makes every one of those a
    // two-thousand-year-old flat, i.e. second-hand, i.e. exactly wrong.
    expect(isClassifiable(0)).toBe(false);
    expect(classifyDeal(0, 2025, MIN_AGE)).toBeNull();
    expect(classifyDeal(1700, 2025, MIN_AGE)).toBeNull();
  });

  it("honours a changed secondhand_min_age", () => {
    expect(classifyDeal(2022, 2025, 2)).toBe("secondhand");
    expect(classifyDeal(2022, 2025, 5)).toBe("new");
  });
});

describe("pctChange", () => {
  // The delta chip is on every KPI in the dashboard, so its edge cases are on
  // screen constantly — and the zero-denominator one renders as a triumph if
  // it is allowed to produce Infinity.
  it("computes an ordinary change in both directions", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(100, 100)).toBe(0);
  });

  it("refuses to compare against a period of zero", () => {
    // 5 visits after 0 is not "+∞%", it is "there is nothing to compare to" —
    // which the UI must render as no arrow at all rather than as growth.
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0); // nothing then, nothing now: unchanged
  });

  it("returns null rather than NaN for a non-finite input", () => {
    expect(pctChange(Number.NaN, 100)).toBeNull();
    expect(pctChange(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("usage insights", () => {
  /**
   * A payload with nothing in it. Every field present, every value empty —
   * which is exactly the shape a quiet site produces, and the shape that
   * tempts every rule to divide by zero and announce a crisis.
   */
  const empty = (): UsagePayload => ({
    days: 30, since: null,
    summary: { sessions: 0, pageViews: 0, totalSeconds: 0, avgSessionSeconds: 0, signedInUsers: 0, devices: [] },
    shape: { sessions: 0, pagesPerVisit: 0, bounceRatePct: 0, signedInSessions: 0 },
    visitors: { visits: 0, visitors: 0, returning: 0, returningPct: 0, frequency: [], devices: [] },
    engagement: { sessions: 0, engaged: 0, engagedPct: 0 },
    sticky: { dau: 0, wau: 0, pct: 0 },
    trend: [], compare: {
      current: { visitors: 0, sessions: 0, pageViews: 0, seconds: 0, bounces: 0, signups: 0, unlocks: 0, errors: 0, returningVisitors: 0, days: 0 },
      previous: { visitors: 0, sessions: 0, pageViews: 0, seconds: 0, bounces: 0, signups: 0, unlocks: 0, errors: 0, returningVisitors: 0, days: 0 },
    },
    rollup: { days: 0, first: null, last: null },
    sources: [], funnel: [], neverUnlocked: 0,
    ttfv: { medianMinutes: null, n: 0, within24hPct: 0 },
    landingConversion: [],
    credits: { granted: 0, spent: 0, outstanding: 0, unlocks: 0, usersWithBalance: 0 },
    cohorts: [], sessionLengths: [], adoption: [], depth: [], sections: [], ctas: [],
    pages: [], cities: [], searches: [], misses: [], paths: [], landings: [],
    exits: [], rage: [], errors: [], vitals: [], users: [], events: [],
  });

  it("says nothing at all about a site with no traffic", () => {
    // The failure this pins down: "0% conversion — urgent!" on an empty log.
    // A board that cries wolf in week one is never trusted in week ten.
    expect(buildUsageInsights(empty())).toEqual([]);
  });

  it("fires on evidence, and stays silent just below the threshold", () => {
    const quiet = empty();
    quiet.shape.sessions = 19;          // one short of the minimum sample
    quiet.engagement = { sessions: 19, engaged: 1, engagedPct: 5 };
    expect(buildUsageInsights(quiet).some((i) => i.id === "low-engagement")).toBe(false);

    const loud = empty();
    loud.shape.sessions = 20;
    loud.engagement = { sessions: 20, engaged: 1, engagedPct: 5 };
    expect(buildUsageInsights(loud).some((i) => i.id === "low-engagement")).toBe(true);
  });

  it("does not congratulate a site on a metric that is bad", () => {
    const bad = empty();
    bad.shape.sessions = 100;
    bad.engagement = { sessions: 100, engaged: 30, engagedPct: 30 };
    const ids = buildUsageInsights(bad).map((i) => i.id);
    expect(ids).toContain("low-engagement");
    expect(ids).not.toContain("keep-engagement");
  });

  it("reports an error screen even when everything else is quiet", () => {
    // Errors are not a ratio and need no sample: one visitor seeing a broken
    // page is a fact, not a rate.
    const e = empty();
    e.errors = [{ path: "/city/חיפה", detail: "abc123", n: 1 }];
    const found = buildUsageInsights(e).find((i) => i.id === "errors");
    expect(found).toBeTruthy();
    expect(found!.severity).toBe(3);
    expect(found!.action).toContain("abc123"); // the digest to search for
  });

  it("every insight carries a number, a meaning AND an action", () => {
    // A card without a recommendation is a fact, and the whole point of the
    // board is that it does not produce those.
    const rich = empty();
    rich.shape.sessions = 200;
    rich.neverUnlocked = 4;
    rich.errors = [{ path: "/", detail: "x", n: 2 }];
    rich.misses = [{ term: "רהט", n: 5 }];
    for (const i of buildUsageInsights(rich)) {
      expect(i.metric.length).toBeGreaterThan(0);
      expect(i.meaning.length).toBeGreaterThan(20);
      expect(i.action.length).toBeGreaterThan(20);
    }
  });

  it("holds the 85/15 mix when both kinds are plentiful", () => {
    const mk = (n: number, kind: Insight["kind"]): Insight[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `${kind}-${i}`, kind, severity: 2 as const, weight: 100 - i,
        metric: "1", title: "t", meaning: "m", action: "a",
      }));
    const { shown } = rankInsights([...mk(20, "fix"), ...mk(10, "keep")], 8);
    expect(shown.filter((i) => i.kind === "fix")).toHaveLength(7);
    expect(shown.filter((i) => i.kind === "keep")).toHaveLength(1);
  });

  it("does not pad one side when the other is short", () => {
    // Filling the board with weak items to reach a count is how a good
    // recommendation ends up next to a meaningless one and loses by association.
    const two: Insight[] = [
      { id: "a", kind: "fix", severity: 3, weight: 10, metric: "1", title: "t", meaning: "m", action: "a" },
      { id: "b", kind: "fix", severity: 1, weight: 1, metric: "1", title: "t", meaning: "m", action: "a" },
    ];
    const { shown, rest } = rankInsights(two, 8);
    expect(shown).toHaveLength(2);
    expect(rest).toHaveLength(0);
    expect(shown[0].id).toBe("a"); // severity first
  });
});

/**
 * The movers board — the card that reported a server fault while the database
 * held 63 qualifying cities.
 *
 * These pin the two halves that failed together: the selection itself, and the
 * DIAGNOSIS of an empty result. The second matters as much as the first,
 * because for months the board answered "no cities in the range you picked"
 * whenever the real cause was that the server sent nothing — sending the
 * reader to adjust a filter that was never the problem, and hiding a
 * server-side fault behind what looked like user error.
 */
describe("movers board", () => {
  const series: GainSeries = {
    "חיפה":      { secondhand: { 2022: [18000, 17500], 2025: [21000, 20000] } },
    "באר שבע":   { secondhand: { 2022: [12000, 11800], 2025: [13000, 12900] } },
    "קריית אתא": { secondhand: { 2022: [12000, 11900], 2025: [16000, 15800] } },
    "עיר חריגה": { secondhand: { 2022: [1000, 1000], 2025: [9000, 9000] } }, // +800%
  };
  const q = { scope: "secondhand", metric: 0 as const, fromY: 2022, toY: 2025, dir: "up" as const };

  it("ranks risers by change, biggest first", () => {
    const rows = selectMovers(series, q);
    expect(rows[0].city).toBe("קריית אתא"); // +33.3%
    expect(rows[1].city).toBe("חיפה");      // +16.7%
  });

  it("ranks fallers in the opposite order from the same data", () => {
    const rows = selectMovers(series, { ...q, dir: "down" });
    expect(rows[0].city).toBe("באר שבע"); // +8.3%, the smallest rise
  });

  /** A city cannot triple in three years; that is a broken row, not a market. */
  it("drops changes past the sanity ceiling", () => {
    expect(selectMovers(series, q).map((r) => r.city)).not.toContain("עיר חריגה");
  });

  it("flags an administered-price year only when it sits on a window EDGE", () => {
    const onEdge = selectMovers(series, { ...q, subsidized: { "חיפה": [2022] } });
    expect(onEdge.find((r) => r.city === "חיפה")?.subsidizedYear).toBe(2022);
    const inside = selectMovers(series, { ...q, subsidized: { "חיפה": [2023] } });
    expect(inside.find((r) => r.city === "חיפה")?.subsidizedYear).toBeNull();
  });

  it("blames the server when the server sent nothing", () => {
    expect(explainEmpty({}, q, 0)).toBe("server");
  });

  it("blames the deal type, the years, or the filter — each on its own", () => {
    expect(explainEmpty(series, { ...q, scope: "new" }, 0)).toBe("scope");
    expect(explainEmpty(series, { ...q, fromY: 1999 }, 0)).toBe("years");
    // every city present in both years, but all of them filtered out
    expect(explainEmpty({ "עיר חריגה": series["עיר חריגה"] }, q, 0)).toBe("filtered");
  });

  it("says nothing at all when there are rows", () => {
    expect(explainEmpty(series, q, 3)).toBeNull();
  });

  /** The visitor's opening view: last FULL year, three years back, risers. */
  it("opens on the last full year, never on the partial one", () => {
    expect(defaultMoversQuery(2026, 2026)).toMatchObject({ fromY: 2022, toY: 2025, scope: "secondhand", dir: "up" });
    expect(defaultMoversQuery(2025, null)).toMatchObject({ fromY: 2022, toY: 2025 });
  });
});

/**
 * The cache guard, which is the actual fix for the blank board: an empty
 * collection from these loaders means the tables were unreadable for an
 * instant, and caching that for six hours turns a blip into an outage.
 */
describe("cache empty-guard", () => {
  it("recognises the empty shapes these loaders return", () => {
    expect(__isEmptyCollection([])).toBe(true);
    expect(__isEmptyCollection(new Map())).toBe(true);
    expect(__isEmptyCollection(new Set())).toBe(true);
  });

  it("leaves a populated result alone", () => {
    expect(__isEmptyCollection([1])).toBe(false);
    expect(__isEmptyCollection(new Map([["a", 1]]))).toBe(false);
    expect(__isEmptyCollection(new Set(["a"]))).toBe(false);
  });

  /** A number or an object is not a collection — guarding those would be wrong. */
  it("does not treat a non-collection as empty", () => {
    expect(__isEmptyCollection(0)).toBe(false);
    expect(__isEmptyCollection({})).toBe(false);
    expect(__isEmptyCollection(null)).toBe(false);
  });
});

/**
 * The ten-year population growth behind the new /cities column. The failure
 * that matters is the quiet one: a city we have no history for must read "—",
 * never 0, because 0 is a claim that it did not grow.
 */
describe("population growth over a span", () => {
  it("measures from the newest year that has a partner a span back", () => {
    const s = new Map([[2014, 100], [2016, 110], [2024, 150], [2026, 200]]);
    expect(growthOverSpan(s, 10)).toBeCloseTo(81.8, 1); // 2026 vs 2016
  });

  it("slides back to an older usable pair when the newest year has none", () => {
    const s = new Map([[2014, 100], [2024, 150], [2026, 200]]);
    expect(growthOverSpan(s, 10)).toBeCloseTo(50, 1); // 2024 vs 2014, not 2026
  });

  it("returns null — not zero — when an endpoint is missing", () => {
    expect(growthOverSpan(new Map([[2026, 200]]), 10)).toBeNull();
    expect(growthOverSpan(new Map(), 10)).toBeNull();
  });

  it("refuses a zero base instead of dividing by it", () => {
    expect(growthOverSpan(new Map([[2016, 0], [2026, 200]]), 10)).toBeNull();
  });

  it("reports a decline as a negative, not as an absence", () => {
    expect(growthOverSpan(new Map([[2016, 200], [2026, 150]]), 10)).toBeCloseTo(-25, 1);
  });
});


/**
 * The section-order editor writes a list of keys into app.db and the pages
 * render from it. The dangerous failures are both silent: a section ADDED to
 * the code after an order was saved disappearing from the live site, and a
 * section DELETED from the code lingering as a phantom row in the dashboard.
 * reconcile() is the single place that prevents both.
 */
describe("page section order", () => {
  it("keeps a saved order exactly as saved", () => {
    const d = defaultOrder("home");
    const shuffled = [...d].reverse();
    expect(reconcile("home", shuffled)).toEqual(shuffled);
  });

  it("appends a section that was added after the order was saved", () => {
    const d = defaultOrder("city");
    const saved = d.slice(0, 3); // an order stored when the page had 3 sections
    const out = reconcile("city", saved);
    expect(out.slice(0, 3)).toEqual(saved);
    expect(out).toHaveLength(d.length);
    for (const k of d) expect(out).toContain(k);
  });

  it("drops a key that no longer exists in the catalogue", () => {
    const out = reconcile("home", ["a-section-that-was-deleted", ...defaultOrder("home")]);
    expect(out).toEqual(defaultOrder("home"));
  });

  it("falls back to the catalogue order when nothing was saved", () => {
    expect(reconcile("home", [])).toEqual(defaultOrder("home"));
  });

  it("has no duplicate keys in any page catalogue", () => {
    for (const p of PAGE_KEYS) {
      const keys = PAGE_SECTIONS[p].map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});


/**
 * The neighbourhood map's geometry. Every one of these is a failure that would
 * be invisible in code review and obvious on screen: a city drawn 20% too tall,
 * streets that do not sit on their neighbourhoods, a coastline that blows the
 * stack, or a sliver polygon with no area.
 */
describe("map geometry", () => {
  it("projects latitude through Mercator, not raw degrees", () => {
    // A degree of latitude and a degree of longitude must NOT come out equal:
    // that is exactly the bug that stretches Israel north-south by ~20%.
    const [x0, y0] = project([34, 32]);
    const [x1, y1] = project([35, 32]);
    const [, y2] = project([34, 33]);
    expect(x1 - x0).toBeCloseTo(Math.PI / 180, 10);
    expect(y2 - y0).toBeGreaterThan(x1 - x0); // Mercator stretches with latitude
    expect(y0).toBeCloseTo(Math.log(Math.tan(Math.PI / 4 + (32 * Math.PI) / 360)), 10);
  });

  it("puts both layers of one city in the same box", () => {
    // The whole point of a shared projector: a street and an outline that share
    // a coordinate must land on the same pixel.
    const bbox = { minLon: 34.7, minLat: 32.0, maxLon: 34.85, maxLat: 32.15 };
    const p = makeProjector(bbox);
    const shared: LonLat = [34.78, 32.08];
    expect(p(shared)).toEqual(p(shared));
    const [x, y] = p(shared);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(VIEW_SIZE);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(VIEW_SIZE);
  });

  it("flips y, because SVG counts downward and latitude counts up", () => {
    const p = makeProjector({ minLon: 34, minLat: 32, maxLon: 35, maxLat: 33 });
    const north = p([34.5, 32.9]);
    const south = p([34.5, 32.1]);
    expect(north[1]).toBeLessThan(south[1]);
  });

  it("does not emit NaN for a degenerate extent", () => {
    const p = makeProjector({ minLon: 34.7, minLat: 32.1, maxLon: 34.7, maxLat: 32.1 });
    const [x, y] = p([34.7, 32.1]);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });

  it("collapses a straight line to its endpoints", () => {
    const line: Point[] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    expect(simplify(line, 0.5)).toEqual([[0, 0], [4, 0]]);
  });

  it("keeps a corner that carries the shape", () => {
    const line: Point[] = [[0, 0], [5, 10], [10, 0]];
    expect(simplify(line, 1)).toEqual(line);
  });

  it("bounds the worst case instead of recursing into it", () => {
    // A line that alternates either side of its own chord is RDP's O(n²) case
    // and keeps every point. Unbounded, 60,000 of them took 67 SECONDS. The
    // decimation cap is what turns that into a predictable cost.
    const adversarial: Point[] = Array.from({ length: 60_000 }, (_, i) => [i, i % 2] as Point);
    const started = Date.now();
    const out = simplify(adversarial, 0.1);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(out.length).toBeLessThanOrEqual(MAX_SIMPLIFY_POINTS);
    expect(() => simplify(adversarial, 0.1)).not.toThrow();
  });

  it("decimates evenly and keeps both ends", () => {
    const line: Point[] = Array.from({ length: 100 }, (_, i) => [i, 0] as Point);
    const out = decimate(line, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([99, 0]);
    expect(decimate(line, 500)).toHaveLength(100); // never pads
  });

  it("keeps a simplified ring closed", () => {
    const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const out = simplifyRing(square, 0.5)!;
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out[0]).toEqual(out[out.length - 1]);
  });

  it("drops a ring that simplifies away instead of drawing a sliver", () => {
    const sliver: Point[] = [[0, 0], [10, 0], [20, 0], [0, 0]];
    expect(simplifyRing(sliver, 1)).toBeNull();
    expect(simplifyRing([[0, 0], [1, 1]] as Point[], 1)).toBeNull();
  });

  it("measures length and finds a centre inside the shape", () => {
    expect(lineLength([[0, 0], [3, 4]])).toBeCloseTo(5, 6);
    expect(ringCentroid([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])).toEqual([5, 5]);
  });

  it("reports an untouched bbox as empty rather than as a point at infinity", () => {
    expect(bboxIsEmpty(emptyBBox())).toBe(true);
    expect(bboxIsEmpty(extendBBox(emptyBBox(), [34.7, 32.1]))).toBe(false);
  });
});


/** A price row shaped like lib/neighborhoods produces. */
const nb = (neighborhood: string, sqm: number) => ({
  neighborhood, year: 2025, sqm, n: 40, changePct: 5, fromYear: 2022, vsCityPct: 0,
});
const geo = (names: string[]): CityMapGeometry => ({
  shapes: names.map((n, i) => ({ neighborhood: n, normName: normHoodKey(n), path: "M0,0L1,1Z", cx: i, cy: i })),
  lines: [],
});

describe("neighbourhood map bins and join", () => {
  it("uses the city's own range, not absolute shekel thresholds", () => {
    // The same five bins must appear whether the city is Beer Sheva or Tel Aviv
    // — an absolute scale paints one of them a single shade.
    const cheap = priceBins([10_000, 12_000, 14_000, 16_000, 18_000]);
    const dear = priceBins([50_000, 60_000, 70_000, 80_000, 90_000]);
    expect(cheap).toHaveLength(4);
    expect(dear).toHaveLength(4);
    expect(binOf(10_000, cheap)).toBe(0);
    expect(binOf(18_000, cheap)).toBe(4);
    expect(binOf(50_000, dear)).toBe(0);
    expect(binOf(90_000, dear)).toBe(4);
  });

  it("does not divide by zero on one neighbourhood or on equal prices", () => {
    expect(() => priceBins([20_000])).not.toThrow();
    expect(priceBins([]).length).toBe(0);
    const flat = priceBins([20_000, 20_000, 20_000]);
    expect(flat.every((e) => Number.isFinite(e))).toBe(true);
    expect(Number.isFinite(binOf(20_000, flat))).toBe(true);
  });

  it("ignores nonsense values instead of binning them", () => {
    expect(priceBins([NaN, 0, -5, 10_000, 20_000, 30_000, 40_000, 50_000])).toHaveLength(4);
  });

  it("joins across a hyphen and a doubled yod", () => {
    const view = buildCityMap(
      geo(["הצפון הישן-החלק הצפוני", "נוה צדק", "פלורנטין"]),
      [nb("הצפון הישן החלק הצפוני", 60_000), nb("נווה צדק", 70_000), nb("פלורנטין", 50_000)]
    );
    expect(view).not.toBeNull();
    expect(view!.matched).toBe(3);
    expect(view!.unmatchedPriced).toEqual([]);
  });

  it("draws a shape with no price rather than hiding it", () => {
    const view = buildCityMap(
      geo(["א", "ב", "ג", "ד"]),
      [nb("א", 10_000), nb("ב", 20_000), nb("ג", 30_000)]
    );
    expect(view!.neighborhoods).toHaveLength(4);
    expect(view!.neighborhoods.find((n) => n.neighborhood === "ד")!.summary).toBeNull();
    expect(view!.neighborhoods.find((n) => n.neighborhood === "ד")!.bin).toBeNull();
  });

  it("reports a priced neighbourhood that has no shape instead of dropping it", () => {
    const view = buildCityMap(geo(["א", "ב", "ג"]), [nb("א", 1), nb("ב", 2), nb("ג", 3), nb("ד", 4)]);
    expect(view!.unmatchedPriced).toEqual(["ד"]);
  });

  it("refuses a map that would cover less than half the city", () => {
    // Four priced neighbourhoods, one shape: the reader would see three
    // blanks and conclude there are no deals there.
    expect(buildCityMap(geo(["א"]), [nb("א", 1), nb("ב", 2), nb("ג", 3), nb("ד", 4)])).toBeNull();
  });

  it("refuses when the collector has not run for this city", () => {
    expect(buildCityMap({ shapes: [], lines: [] }, [nb("א", 1)])).toBeNull();
  });

  it("does not attach a price when the containment is ambiguous", () => {
    // Two priced rows both contain the shape's name — guessing would put a
    // real number on the wrong polygon.
    const view = buildCityMap(
      geo(["רמת", "א", "ב", "ג"]),
      [nb("רמת אביב", 50_000), nb("רמת החייל", 60_000), nb("א", 1), nb("ב", 2), nb("ג", 3)]
    );
    expect(view!.neighborhoods.find((n) => n.neighborhood === "רמת")!.summary).toBeNull();
  });
});
