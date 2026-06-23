/**
 * Parser for yadata.yad2.co.il city page text content.
 * Extracts the 4 main KPIs + market type from the page text.
 *
 * Expected text structure (Hebrew):
 *   5,080
 *   נכסים חדשים שמוצעים למכירה
 *   4%+ משנה קודמת
 *   6,895
 *   נכסים יד שניה שמוצעים למכירה
 *   6%- משנה קודמת
 *   ...
 */
export interface YadataKpis {
  new_properties: number | null;
  new_properties_yoy: number | null;
  secondhand_properties: number | null;
  secondhand_yoy: number | null;
  avg_days_on_market: number | null;
  days_yoy: number | null;
  buyers_count: number | null;
  buyers_yoy: number | null;
  market_type: "sellers" | "buyers" | "balanced" | null;
  households: number | null;
  avg_household_size: number | null;
}

function parseHebrewYoY(text: string): number | null {
  // "4%+ משנה קודמת" or "6%- משנה קודמת" or "0% משנה קודמת"
  const m = text.match(/(\d+(?:\.\d+)?)%([+-]?)\s+משנה קודמת/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  return m[2] === "-" ? -num : num;
}

function parseNumber(text: string): number | null {
  // "5,080" → 5080
  const cleaned = text.replace(/,/g, "").trim();
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

export function parseYadataPage(pageText: string): YadataKpis {
  const result: YadataKpis = {
    new_properties: null,
    new_properties_yoy: null,
    secondhand_properties: null,
    secondhand_yoy: null,
    avg_days_on_market: null,
    days_yoy: null,
    buyers_count: null,
    buyers_yoy: null,
    market_type: null,
    households: null,
    avg_household_size: null,
  };

  const lines = pageText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  // Find labeled metrics. The pattern is:
  // <number-line>
  // <label-line>
  // <yoy-line>
  for (let i = 0; i < lines.length - 2; i++) {
    const numLine = lines[i];
    const labelLine = lines[i + 1];
    const yoyLine = lines[i + 2];

    if (!/^[\d,]+$/.test(numLine)) continue;
    const num = parseNumber(numLine);
    if (num === null) continue;
    const yoy = parseHebrewYoY(yoyLine);

    if (labelLine.includes("נכסים חדשים שמוצעים")) {
      result.new_properties = num;
      result.new_properties_yoy = yoy;
    } else if (labelLine.includes("נכסים יד שניה")) {
      result.secondhand_properties = num;
      result.secondhand_yoy = yoy;
    } else if (labelLine.includes("מספר הימים הממוצע")) {
      result.avg_days_on_market = num;
      result.days_yoy = yoy;
    } else if (labelLine.includes("הקונים שפתחו מודעה")) {
      result.buyers_count = num;
      result.buyers_yoy = yoy;
    }
  }

  // Households data — appears as:
  //   <number>
  //   מספר משקי בית
  //   <decimal>
  //   ממוצע נפשות למשק בית
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i + 1] === "מספר משקי בית") {
      const n = parseNumber(lines[i]);
      if (n !== null) result.households = n;
    }
    if (lines[i + 1] === "ממוצע נפשות למשק בית") {
      const v = parseFloat(lines[i].replace(/,/g, ""));
      if (!isNaN(v)) result.avg_household_size = v;
    }
  }

  // Market type detection — Yadata highlights one of 3 options + adds a contextual paragraph.
  // The contextual paragraph IDs which one is active:
  //   "בשוק אין יתרון מובהק"            → balanced
  //   "שוק ידידותי למוכרים בדרך כלל"     → sellers
  //   "שוק ידידותי לקונים בדרך כלל"      → buyers
  if (/בשוק אין יתרון מובהק/.test(pageText)) {
    result.market_type = "balanced";
  } else if (/שוק ידידותי למוכרים בדרך כלל/.test(pageText)) {
    result.market_type = "sellers";
  } else if (/שוק ידידותי לקונים בדרך כלל/.test(pageText)) {
    result.market_type = "buyers";
  }

  return result;
}
