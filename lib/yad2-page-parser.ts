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
  // "מד השוק" — Yadata's market gauge (numeric, varies by city — typically a
  // small integer or percentage). Null when not found on the page.
  market_gauge: number | null;
  // "מדד התפשרות" — average % gap between asking price and actual deal price.
  // Positive value means sellers are accepting LESS than asking.
  compromise_index: number | null;
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
    market_gauge: null,
    compromise_index: null,
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

  // "מד השוק" (Market Gauge) — Yadata shows a numeric gauge that quantifies the
  // sellers/buyers tilt. We try several layouts because the page changes slowly:
  //
  //   variant A — line-pair: <number>\nמד השוק
  //   variant B — inline:    "מד השוק: 7.5"  or  "מד השוק 7.5"
  //   variant C — with %:    "מד השוק 64%"
  //
  // The first matching pattern wins.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "מד השוק" || lines[i].includes("מד השוק")) {
      // variant A — number on previous line
      const prevNum = parseFloat(lines[i - 1].replace(/[,%]/g, "").trim());
      if (!isNaN(prevNum) && prevNum >= 0 && prevNum <= 1000) {
        result.market_gauge = prevNum;
        break;
      }
    }
  }
  if (result.market_gauge === null) {
    // variants B and C — inline match on the whole text
    const m = pageText.match(/מד השוק[:\s]+(\d+(?:\.\d+)?)%?/);
    if (m) {
      const v = parseFloat(m[1]);
      if (!isNaN(v) && v >= 0 && v <= 1000) result.market_gauge = v;
    }
  }

  // "מדד התפשרות" (Compromise Index) — average % gap between asking price and
  // actual deal price. Always shown as a percentage in Yadata.
  //
  //   variant A — line-pair: "3.5%"\nמדד התפשרות
  //   variant B — inline:    "מדד התפשרות 3.5%"  or  "מדד התפשרות: 3.5%"
  //   variant C — explanation: "X% פער בין מחיר מבוקש למחיר עסקה"
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "מדד התפשרות" || lines[i].includes("מדד התפשרות")) {
      const pctMatch = lines[i - 1].match(/(\d+(?:\.\d+)?)%/);
      if (pctMatch) {
        const v = parseFloat(pctMatch[1]);
        if (!isNaN(v) && v >= -100 && v <= 100) {
          result.compromise_index = v;
          break;
        }
      }
    }
  }
  if (result.compromise_index === null) {
    const m = pageText.match(/מדד התפשרות[:\s]+(-?\d+(?:\.\d+)?)%/);
    if (m) {
      const v = parseFloat(m[1]);
      if (!isNaN(v) && v >= -100 && v <= 100) result.compromise_index = v;
    }
  }
  if (result.compromise_index === null) {
    const m = pageText.match(/(\d+(?:\.\d+)?)%\s+פער בין מחיר מבוקש/);
    if (m) {
      const v = parseFloat(m[1]);
      if (!isNaN(v) && v >= -100 && v <= 100) result.compromise_index = v;
    }
  }

  return result;
}
