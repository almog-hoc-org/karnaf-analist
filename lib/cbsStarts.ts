/**
 * Building starts by city, from the CBS press releases "התחלות וגמר בנייה".
 *
 * Every quarterly release carries one city table inside the release document
 * itself (b.docx), "לוח א - דירות שהחלה בנייתן, לפי יישובים נבחרים": a
 * national-total row, then the cities that started more than 500 dwellings in
 * the release's latest period, over four 12-month periods. The March release
 * gives calendar years; June, September and December give trailing 12 months.
 * No attachment (xls/xlsx) has the city breakdown, so the document is the
 * source.
 *
 * The CBS revises starts upward for a year or more after first print
 * (Jerusalem 2024: 5,183 in March 2025, 6,326 in March 2026), so a period is
 * read from the NEWEST release that reports it (latestVintage).
 *
 * Pure: no database, no network; pinned in tests/pure.test.ts. The fetch and
 * the writes are scripts/collect-cbs-starts.ts.
 */
import * as XLSX from "xlsx";
import { canonicalCityName } from "./cityAliases";

export const CBS_STARTS_SUBJECT_URL =
  "https://www.cbs.gov.il/he/subjects/Pages/%D7%94%D7%AA%D7%97%D7%9C%D7%95%D7%AA-%D7%91%D7%A0%D7%99%D7%99%D7%94-%D7%95%D7%92%D7%9E%D7%A8-%D7%91%D7%A0%D7%99%D7%99%D7%94.aspx";

/** The national-total row's name in our rows (the release spells it a few ways). */
export const NATIONAL_TOTAL = "סך הכל ארצי";

const MONTHS: Record<string, number> = {
  ינואר: 1, פברואר: 2, מרץ: 3, מרס: 3, אפריל: 4, מאי: 5, יוני: 6,
  יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
};

/** One table cell per entry, rows in document order. */
export type DocTable = string[][];

/** The text of every table in a .docx (word/document.xml), cells joined from their w:t runs. */
export function docxTables(buf: Buffer | Uint8Array): DocTable[] {
  const zip = XLSX.CFB.read(Buffer.from(buf), { type: "buffer" });
  const i = zip.FullPaths.findIndex((p: string) => p.endsWith("/word/document.xml"));
  if (i < 0) throw new Error("not a .docx: word/document.xml is missing");
  const xml = Buffer.from(zip.FileIndex[i].content as Uint8Array).toString("utf8");
  return docxXmlTables(xml);
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function docxXmlTables(xml: string): DocTable[] {
  return (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []).map((t) =>
    (t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((r) =>
      (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) =>
        unescapeXml((c.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, "")).join("")).trim(),
      ),
    ),
  );
}

/** The city table: the one whose first header cell is "יישוב". */
export function findCityTable(tables: DocTable[]): DocTable | null {
  return tables.find((t) => /^יישוב/.test(t[0]?.[0]?.trim() ?? "")) ?? null;
}

/**
 * A 12-month period, identified by the month it ends ("2025-12" for the year
 * 2025, "2026-06" for July 2025–June 2026). Null for anything that is not a
 * year or a 12-month span — the percent-change column, for one.
 */
export interface Period { end: string; kind: "year" | "12m"; label: string }

export function parsePeriodLabel(raw: string): Period | null {
  const s = raw.replace(/\s+/g, " ").trim();
  const year = s.match(/^(?:שנת )?((?:19|20)\d\d)$/);
  if (year) return { end: `${year[1]}-12`, kind: "year", label: year[1] };
  const span = s.match(/^(\S+) ((?:19|20)\d\d) ?[-–] ?(\S+) ((?:19|20)\d\d)$/);
  if (!span) return null;
  const m1 = MONTHS[span[1]], m2 = MONTHS[span[3]];
  const y1 = Number(span[2]), y2 = Number(span[4]);
  if (!m1 || !m2) return null;
  // 12 months exactly: the span starts the month after the same month a year earlier
  if ((y2 * 12 + m2) - (y1 * 12 + m1) !== 11) return null;
  const end = `${y2}-${String(m2).padStart(2, "0")}`;
  if (m2 === 12) return { end, kind: "year", label: String(y2) };
  return { end, kind: "12m", label: `${span[1]} ${y1}–${span[3]} ${y2}` };
}

/** "4,837" → 4837; "-", "..", "" → null (not published / not applicable). */
export function parseCount(raw: string): number | null {
  const s = raw.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Release spelling → our spelling: footnote marks, "מזה:" prefixes, spaces around hyphens. */
export function cleanCityName(raw: string): string {
  const s = raw
    .replace(/[*()\d]+$/g, "")
    .replace(/^מזה\s*:?\s*/, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (/^סך ה?כל/.test(s) || s === "ארצי") return NATIONAL_TOTAL;
  return canonicalCityName(s);
}

export interface StartsRow {
  releaseNo: string;        // "297/2026"
  releaseDate: string;      // "2026-09-17"
  periodEnd: string;        // "2026-06"
  periodKind: "year" | "12m";
  periodLabel: string;
  cityRaw: string;
  city: string;
  starts: number;
}

/** Every (city, period, count) of one release's city table. */
export function parseStartsTable(table: DocTable, release: { no: string; date: string }): StartsRow[] {
  const header = table[0] ?? [];
  const periods = header.map((h, i) => (i === 0 ? null : parsePeriodLabel(h)));
  const out: StartsRow[] = [];
  for (const row of table.slice(1)) {
    const cityRaw = (row[0] ?? "").trim();
    if (!cityRaw) continue;
    const city = cleanCityName(cityRaw);
    periods.forEach((p, i) => {
      if (!p) return;
      const n = parseCount(row[i] ?? "");
      if (n == null) return;
      out.push({ releaseNo: release.no, releaseDate: release.date, periodEnd: p.end, periodKind: p.kind, periodLabel: p.label, cityRaw, city, starts: n });
    });
  }
  return out;
}

/** Per (city, period) the value from the newest release that reports it. */
export function latestVintage<T extends Pick<StartsRow, "city" | "periodEnd" | "releaseDate">>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.city}\u0000${r.periodEnd}`;
    const cur = best.get(k);
    if (!cur || r.releaseDate > cur.releaseDate) best.set(k, r);
  }
  return [...best.values()];
}

export interface StartsTableRow {
  city: string;
  /** year → dwellings started (calendar years only) */
  years: Record<number, number>;
  /** the latest trailing-12-month window, when it is newer than the latest year */
  latest: number | null;
  /** the same window a year earlier */
  latestPrev: number | null;
}

export interface StartsTable {
  years: number[];
  /** the latest 12-month window newer than the last full year, if any */
  latestPeriod: { end: string; label: string } | null;
  total: StartsTableRow | null;
  cities: StartsTableRow[];
  releases: number;
  lastRelease: { no: string; date: string } | null;
}

const prevYearEnd = (end: string) => `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`;

/** The city × year table the national page shows, from every release's rows. */
export function buildCityYearTable(all: StartsRow[]): StartsTable {
  const rows = latestVintage(all);
  const yearSet = new Set<number>();
  for (const r of rows) if (r.periodKind === "year") yearSet.add(Number(r.periodEnd.slice(0, 4)));
  const years = [...yearSet].sort((a, b) => a - b);
  const lastYearEnd = years.length ? `${years[years.length - 1]}-12` : "";

  let latestPeriod: StartsTable["latestPeriod"] = null;
  for (const r of rows) {
    if (r.periodKind === "12m" && r.periodEnd > lastYearEnd && (!latestPeriod || r.periodEnd > latestPeriod.end)) {
      latestPeriod = { end: r.periodEnd, label: r.periodLabel };
    }
  }

  const byCity = new Map<string, StartsTableRow>();
  const get = (city: string) => {
    let c = byCity.get(city);
    if (!c) byCity.set(city, (c = { city, years: {}, latest: null, latestPrev: null }));
    return c;
  };
  for (const r of rows) {
    const c = get(r.city);
    if (r.periodKind === "year") c.years[Number(r.periodEnd.slice(0, 4))] = r.starts;
    if (latestPeriod && r.periodEnd === latestPeriod.end) c.latest = r.starts;
    if (latestPeriod && r.periodEnd === prevYearEnd(latestPeriod.end)) c.latestPrev = r.starts;
  }

  const releases = new Map<string, string>();
  for (const r of all) releases.set(r.releaseNo, r.releaseDate);
  const last = [...releases.entries()].sort((a, b) => b[1].localeCompare(a[1]))[0];

  const total = byCity.get(NATIONAL_TOTAL) ?? null;
  byCity.delete(NATIONAL_TOTAL);
  // a city seen only in rolling windows other than the latest has nothing to show
  for (const [k, c] of byCity) if (c.latest == null && !Object.keys(c.years).length) byCity.delete(k);
  const lastYear = years[years.length - 1];
  const cities = [...byCity.values()].sort(
    (a, b) => (b.latest ?? b.years[lastYear] ?? -1) - (a.latest ?? a.years[lastYear] ?? -1) || a.city.localeCompare(b.city, "he"),
  );
  return { years, latestPeriod, total, cities, releases: releases.size, lastRelease: last ? { no: last[0], date: last[1] } : null };
}

/** True for a CBS press-release title about building starts and completions. */
export function isStartsReleaseTitle(title: string): boolean {
  return /התחל/.test(title) && /גמר/.test(title) && /בני/.test(title);
}
