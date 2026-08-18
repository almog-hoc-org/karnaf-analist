export interface CitySearchItem {
  city_name: string;
}

export interface CitySearchHit<T extends CitySearchItem> {
  item: T;
  reason: "exact" | "prefix" | "contains" | "alias" | "typo";
}

const HEBREW_FROM_EN_KEYBOARD: Record<string, string> = {
  q: "/", w: "'", e: "ק", r: "ר", t: "א", y: "ט", u: "ו", i: "ן", o: "ם", p: "פ",
  a: "ש", s: "ד", d: "ג", f: "כ", g: "ע", h: "י", j: "ח", k: "ל", l: "ך",
  z: "ז", x: "ס", c: "ב", v: "ה", b: "נ", n: "מ", m: "צ",
  ",": "ת", ".": "ץ", ";": "ף",
};

function keyboardHebrew(value: string): string {
  return value
    .split("")
    .map((ch) => HEBREW_FROM_EN_KEYBOARD[ch.toLowerCase()] ?? ch)
    .join("");
}

export function normalizeCitySearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[״"]/g, "")
    .replace(/[׳']/g, "")
    .replace(/[-־–—]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")
    .replace(/יי/g, "י")
    .replace(/קרית/g, "קרית")
    .replace(/קריית/g, "קרית");
}

function variants(raw: string): string[] {
  const fromKeyboard = keyboardHebrew(raw);
  const base = normalizeCitySearch(raw);
  const keyed = normalizeCitySearch(fromKeyboard);
  const withYod = normalizeCitySearch(raw.replace(/קרית/g, "קריית"));
  return [...new Set([base, keyed, withYod].filter(Boolean))];
}

function distanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i += 1;
      j += 1;
    } else if (a.length > b.length) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function citySearch<T extends CitySearchItem>(items: T[], query: string, limit = 20): CitySearchHit<T>[] {
  const qs = variants(query);
  if (!qs.length) return [];

  const scored: Array<{ item: T; score: number; reason: CitySearchHit<T>["reason"] }> = [];
  for (const item of items) {
    const name = normalizeCitySearch(item.city_name);
    let score = Number.POSITIVE_INFINITY;
    let reason: CitySearchHit<T>["reason"] = "contains";

    for (const q of qs) {
      if (name === q) {
        score = Math.min(score, 0);
        reason = "exact";
      } else if (name.startsWith(q)) {
        score = Math.min(score, 10 + name.length - q.length);
        reason = score < 20 ? "prefix" : reason;
      } else if (name.includes(q)) {
        score = Math.min(score, 30 + name.indexOf(q));
        reason = score < 40 ? "contains" : reason;
      } else if (q.length >= 3 && name.split(" ").some((part) => part.startsWith(q))) {
        score = Math.min(score, 45);
        reason = "alias";
      } else if (q.length >= 4 && (distanceAtMostOne(name.slice(0, q.length), q) || distanceAtMostOne(name, q))) {
        score = Math.min(score, 60);
        reason = "typo";
      }
    }

    if (Number.isFinite(score)) scored.push({ item, score, reason });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.item.city_name.localeCompare(b.item.city_name, "he"))
    .slice(0, limit)
    .map(({ item, reason }) => ({ item, reason }));
}
