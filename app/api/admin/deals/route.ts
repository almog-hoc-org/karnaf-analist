import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest } from "@/lib/adminAuth";
import { ensureAuditLogPrisma } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/**
 * Admin deals browser API.
 * GET  — server-side pagination + full filtering over nadlan_transactions.
 * POST — exclude / unexclude: single ids or "everything matching the filter".
 */

interface Filters {
  city?: string; street?: string; neighborhood?: string;
  yearFrom?: number; yearTo?: number;
  priceMin?: number; priceMax?: number; sqmMin?: number; sqmMax?: number;
  rooms?: string; source?: string;
  cls?: "secondhand" | "new" | "unclassified" | "";
  excluded?: "yes" | "no" | "";
  reason?: string; // filter by exclusion_reason (e.g. 'חריג-שוק' for non-market deals)
  luxury?: "yes" | "no" | ""; // luxury deals are ACTIVE — they leave the prices, not the counts
}

/**
 * buildWhere() seeds its condition list with "1=1", so a filter object with
 * nothing set produces `WHERE 1=1` — which the bulk UPDATE below would happily
 * apply to every row, emptying the site in one request. A mutation must prove
 * it is targeted, and the proof is `conds`: the number of conditions the WHERE
 * really carries. An earlier guard counted the filter FIELDS instead, and
 * `{yearFrom: 0}` or `{cls: "x"}` counted as a filter while adding no
 * condition — `WHERE 1=1` with a passing guard.
 */
export function buildWhere(f: Filters): { where: string; params: unknown[]; conds: number } {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  if (f.city) { conds.push("city_name = ?"); params.push(f.city); }
  if (f.street) { conds.push("street LIKE ?"); params.push(`%${f.street}%`); }
  if (f.neighborhood) { conds.push("neighborhood LIKE ?"); params.push(`%${f.neighborhood}%`); }
  if (f.yearFrom) { conds.push("deal_year >= ?"); params.push(f.yearFrom); }
  if (f.yearTo) { conds.push("deal_year <= ?"); params.push(f.yearTo); }
  if (f.priceMin) { conds.push("price >= ?"); params.push(f.priceMin); }
  if (f.priceMax) { conds.push("price <= ?"); params.push(f.priceMax); }
  if (f.sqmMin) { conds.push("price_sqm >= ?"); params.push(f.sqmMin); }
  if (f.sqmMax) { conds.push("price_sqm <= ?"); params.push(f.sqmMax); }
  if (f.rooms) { conds.push("room_bucket = ?"); params.push(f.rooms); }
  if (f.source) { conds.push("source = ?"); params.push(f.source); }
  if (f.cls === "secondhand") conds.push("is_secondhand = 1");
  else if (f.cls === "new") conds.push("year_built IS NOT NULL AND is_secondhand = 0");
  else if (f.cls === "unclassified") conds.push("year_built IS NULL");
  if (f.excluded === "yes") conds.push("COALESCE(excluded,0) = 1");
  else if (f.excluded === "no") conds.push("COALESCE(excluded,0) = 0");
  if (f.reason) { conds.push("exclusion_reason LIKE ?"); params.push(`%${f.reason}%`); }
  if (f.luxury === "yes") conds.push("COALESCE(luxury,0) = 1");
  else if (f.luxury === "no") conds.push("COALESCE(luxury,0) = 0");
  return { where: conds.join(" AND "), params, conds: conds.length - 1 };
}

function parseFilters(sp: URLSearchParams): Filters {
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  return {
    city: sp.get("city") ?? undefined,
    street: sp.get("street") ?? undefined,
    neighborhood: sp.get("neighborhood") ?? undefined,
    yearFrom: num("yearFrom"), yearTo: num("yearTo"),
    priceMin: num("priceMin"), priceMax: num("priceMax"),
    sqmMin: num("sqmMin"), sqmMax: num("sqmMax"),
    rooms: sp.get("rooms") ?? undefined,
    source: sp.get("source") ?? undefined,
    cls: (sp.get("cls") as Filters["cls"]) ?? "",
    excluded: (sp.get("excluded") as Filters["excluded"]) ?? "",
    reason: sp.get("reason") ?? undefined,
    luxury: (sp.get("luxury") as Filters["luxury"]) ?? "",
  };
}

/** rows a filtered bulk mutation may touch without an explicit confirm */
const BULK_CONFIRM_ABOVE = 50_000;

const SORTABLE = new Set(["deal_date", "deal_year", "city_name", "street", "price", "price_sqm", "area", "rooms", "year_built", "source"]);

export async function GET(req: NextRequest) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const { where, params } = buildWhere(parseFilters(sp));
  const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));
  const per = Math.min(200, Math.max(10, Math.floor(Number(sp.get("per")) || 50)));
  const sort = SORTABLE.has(sp.get("sort") ?? "") ? sp.get("sort") : "deal_date";
  const dir = sp.get("dir") === "asc" ? "ASC" : "DESC";

  const [cnt] = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*) c FROM nadlan_transactions WHERE ${where}`, ...params
  );
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, city_name, neighborhood, street, house_num, floor, deal_date, deal_year,
            rooms, rooms_effective, room_reclassified, room_bucket, area, price, price_sqm, year_built, is_secondhand,
            COALESCE(excluded,0) excluded, exclusion_reason, source, COALESCE(luxury,0) luxury
     FROM nadlan_transactions WHERE ${where}
     ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`,
    ...params, per, (page - 1) * per
  );
  // SQLite raw rows arrive with BigInt for INTEGER columns — normalize everything.
  const sane = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === "bigint" ? Number(v) : v;
    return o;
  });
  return NextResponse.json({ total: Number(cnt?.c ?? 0), page, per, rows: sane });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const action = body.action === "unexclude" ? "unexclude" : body.action === "exclude" ? "exclude" : null;
  if (!action) return NextResponse.json({ error: "action must be exclude or unexclude" }, { status: 400 });
  const reason: string = String(body.reason ?? "").slice(0, 300);
  const setVal = action === "exclude" ? 1 : 0;

  let affected = 0;
  let filterDesc = "";
  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const ids = body.ids.map((x: unknown) => Number(x)).filter(Number.isFinite).slice(0, 5000);
    const ph = ids.map(() => "?").join(",");
    const res = await prisma.$executeRawUnsafe(
      `UPDATE nadlan_transactions SET excluded=?, exclusion_reason=? WHERE id IN (${ph})`,
      setVal, setVal ? reason || null : null, ...ids
    );
    affected = Number(res);
    filterDesc = `ids: ${ids.length}`;
  } else if (body.filters) {
    const filters = (body.filters && typeof body.filters === "object" ? body.filters : {}) as Filters;
    // An unfiltered bulk mutation is never a legitimate admin action — it is
    // either a mistake or an attack, and either way it would blank the archive.
    const { where, params, conds } = buildWhere(filters);
    if (conds === 0) {
      return NextResponse.json(
        { error: "פעולה גורפת ללא סינון נחסמה — יש לציין לפחות מסנן אחד שמצמצם" },
        { status: 400 }
      );
    }
    // A targeted filter can still be wide (one city, one source). Above this
    // many rows the caller has to say so explicitly.
    const [cnt] = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*) c FROM nadlan_transactions WHERE ${where}`, ...params
    );
    const matching = Number(cnt?.c ?? 0);
    if (matching > BULK_CONFIRM_ABOVE && body.confirm !== true) {
      return NextResponse.json(
        { error: `הסינון תופס ${matching.toLocaleString("he-IL")} עסקאות — לאישור יש לשלוח confirm:true`, matching, confirmRequired: true },
        { status: 409 }
      );
    }
    const res = await prisma.$executeRawUnsafe(
      `UPDATE nadlan_transactions SET excluded=?, exclusion_reason=? WHERE ${where}`,
      setVal, setVal ? reason || null : null, ...params
    );
    affected = Number(res);
    filterDesc = JSON.stringify(filters);
  } else {
    return NextResponse.json({ error: "ids or filters required" }, { status: 400 });
  }

  await ensureAuditLogPrisma(prisma); // fresh deployments have no such table — see lib/auditLog.ts
  await prisma.$executeRawUnsafe(
    `INSERT INTO admin_exclusion_log (action, affected, filter_desc, reason) VALUES (?, ?, ?, ?)`,
    action, affected, filterDesc, reason || null
  );
  return NextResponse.json({ ok: true, affected });
}
