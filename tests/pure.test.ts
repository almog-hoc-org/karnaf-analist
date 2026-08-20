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
