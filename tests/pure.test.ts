import { describe, it, expect } from "vitest";
import { gradeTrend } from "@/lib/confidence";
import { canonicalCityName, normalizeCity, sameCity } from "@/lib/cityAliases";
import { toVisualRtl } from "@/lib/rtlVisual";
import { PIPELINE, STAGE_IDS, stagesFrom, mutationStages } from "@/lib/pipeline";

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
