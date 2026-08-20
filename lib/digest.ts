import { appDb } from "./appDb";
import { siteUrl } from "./share";
import { loadCityTransactionPrices } from "./cityTransactionPrices";
import { loadCityPriceChanges } from "./price-changes";
import { citySubsidizedYears } from "./subsidizedYears";

/**
 * Weekly digest for the cities a user follows.
 *
 * WHY THIS EXISTS
 * The site had no way of ever reaching a reader again. Someone could sign up,
 * research a city, and there was no mechanism — none — that would bring them
 * back. Everything needed for one already existed: Resend is wired and paid
 * for, mailing consent is collected at registration and honoured, and
 * `tracked_cities` records exactly who cares about what. Nothing sent anything.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not email someone whose cities have nothing to report. A weekly note
 * that says "no change this week" every week for two months trains people to
 * delete it unread, and then the one week something moves, they do not see it
 * either. A digest with nothing in it is not sent at all.
 *
 * It also inherits the site's disclosure rules rather than restating them
 * loosely: a city whose window edge is an administered-price year (מחיר למשתכן)
 * carries the same warning in the email that it carries on the page, because a
 * number that needs a caveat needs it more in an inbox, where nobody can click
 * a tooltip.
 */

export interface DigestCity {
  city: string;
  sqm: number | null;
  priceYear: number | null;
  n: number;
  changePct: number | null;
  fromYear: number | null;
  toYear: number | null;
  /** administered-price year sitting on a window edge, if any */
  subsidizedYear: number | null;
}

export interface DigestRecipient {
  email: string;
  name: string;
  cities: DigestCity[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const nis = (v: number | null) => (v == null ? "—" : `₪${Math.round(v).toLocaleString("he-IL")}`);
const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

/**
 * Everyone who consented to mail and follows at least one city, with that
 * user's cities resolved to the same numbers the city page shows.
 *
 * The per-city work is memoised across recipients: two people following תל אביב
 * cost one lookup, not two, which matters once the list is longer than the
 * cities in it.
 */
export async function buildDigest(): Promise<DigestRecipient[]> {
  const rows = appDb().prepare(
    `SELECT u.email, u.name, t.city_name
       FROM tracked_cities t
       JOIN users u ON u.id = CAST(substr(t.user_id, 2) AS INTEGER)
      WHERE u.mailing_consent = 1
      ORDER BY u.id, t.id`
  ).all() as Array<{ email: string; name: string; city_name: string }>;
  if (!rows.length) return [];

  const prices = await loadCityTransactionPrices();
  const cache = new Map<string, DigestCity>();

  const resolve = async (city: string): Promise<DigestCity> => {
    const hit = cache.get(city);
    if (hit) return hit;
    const p = prices.get(city);
    const changes = await loadCityPriceChanges(city);
    // 3y first, 5y as the fallback — the same pair and the same order the city
    // page's headline uses, so the email and the page can never quote different
    // windows for the same city.
    const win = changes?.change3y ?? changes?.change5y ?? null;
    const flagged = await citySubsidizedYears(city);
    const out: DigestCity = {
      city,
      sqm: p?.avgAllSqm ?? p?.medianAllSqm ?? null,
      priceYear: p?.priceYear ?? null,
      n: p?.nPriceYear ?? 0,
      changePct: win?.pct ?? null,
      fromYear: win?.fromY ?? null,
      toYear: win?.toY ?? null,
      subsidizedYear:
        flagged.find((f) => f.year === win?.fromY || f.year === win?.toY)?.year ?? null,
    };
    cache.set(city, out);
    return out;
  };

  const byUser = new Map<string, DigestRecipient>();
  for (const r of rows) {
    let u = byUser.get(r.email);
    if (!u) { u = { email: r.email, name: r.name, cities: [] }; byUser.set(r.email, u); }
    u.cities.push(await resolve(r.city_name));
  }

  // Nothing to say → no email. See the note at the top: a digest that is empty
  // every week is how the one that is not gets ignored too.
  return [...byUser.values()].filter((u) => u.cities.some((c) => c.sqm != null));
}

export function digestHtml(r: DigestRecipient): string {
  const base = siteUrl();
  const rowsHtml = r.cities
    .filter((c) => c.sqm != null)
    .map((c) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0">
          <a href="${base}/city/${encodeURIComponent(c.city)}" style="color:#4338ca;font-weight:bold;text-decoration:none">${esc(c.city)}</a>
          ${c.subsidizedYear ? `<div style="font-size:11px;color:#b45309;margin-top:3px">⚠ ${c.subsidizedYear}: מחיר למשתכן בקצה החישוב — השינוי משקף גם שינוי בתמהיל</div>` : ""}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:left;white-space:nowrap">
          <b>${nis(c.sqm)}</b><span style="color:#94a3b8;font-size:11px"> למ״ר · ${c.priceYear ?? ""}</span>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:left;white-space:nowrap;color:${
          c.changePct == null ? "#94a3b8" : c.changePct >= 0 ? "#047857" : "#be123c"
        }">
          <b>${pct(c.changePct)}</b>${c.fromYear && c.toYear ? `<span style="color:#94a3b8;font-size:11px"> ${c.toYear} \u2190 ${c.fromYear}</span>` : ""}
        </td>
      </tr>`)
    .join("");

  return `<!doctype html><html dir="rtl" lang="he"><body style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e2e8f0">
    <p style="margin:0 0 6px;font-size:12px;color:#6366f1;font-weight:bold">🦏 קרנף אנליסט</p>
    <h1 style="margin:0 0 4px;font-size:20px;color:#0f172a">הערים שלך השבוע</h1>
    <p style="margin:0 0 18px;font-size:13px;color:#64748b">מחיר למ״ר ושינוי, מעסקאות אמת שדווחו לרשות המסים.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155">${rowsHtml}</table>
    <p style="margin:20px 0 0;font-size:13px">
      <a href="${base}/check" style="color:#4338ca;font-weight:bold;text-decoration:none">בדיקת מחיר דירה ספציפית →</a>
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0 12px"/>
    <p style="margin:0;font-size:11px;color:#94a3b8">
      קיבלת מייל זה כי סימנת ★ על הערים האלה ·
      <a href="${base}/account" style="color:#6366f1">ניהול המעקב וההסרה מהדיוור</a>
    </p>
  </div></body></html>`;
}

export function digestText(r: DigestRecipient): string {
  const base = siteUrl();
  const lines = r.cities
    .filter((c) => c.sqm != null)
    .map((c) => `${c.city}: ${nis(c.sqm)} למ״ר (${c.priceYear}) · ${pct(c.changePct)}${c.fromYear ? ` ${c.toYear} \u2190 ${c.fromYear}` : ""}`);
  return `הערים שלך השבוע\n\n${lines.join("\n")}\n\n${base}/check\n\n—\nניהול המעקב וההסרה מהדיוור: ${base}/account`;
}
