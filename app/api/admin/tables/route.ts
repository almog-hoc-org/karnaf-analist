import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appDb } from "@/lib/appDb";
import { isAdminRequest } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/** Tables that hold credentials or session tokens — never browsable, even by admin.
 *  The tables browser is for inspecting DATA, not secrets. */
const SENSITIVE_TABLES = new Set(["users", "sessions", "_prisma_migrations"]);

/** Read-only browser over every table in both databases (analytics + app). */
const norm = (rows: any[]) =>
  rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === "bigint" ? Number(v) : v;
    return o;
  });

export async function GET(req: NextRequest) {
  if (!isAdminRequest()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const table = req.nextUrl.searchParams.get("table");
  const db = req.nextUrl.searchParams.get("db") === "app" ? "app" : "analytics";

  if (!table) {
    // list both databases' tables with row counts
    const analytics = norm(await prisma.$queryRawUnsafe<any[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ));
    const out: Array<{ db: string; name: string; rows: number }> = [];
    for (const t of analytics) {
      const [c] = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) c FROM "${t.name}"`).catch(() => [{ c: 0 }]);
      out.push({ db: "analytics", name: String(t.name), rows: Number(c?.c ?? 0) });
    }
    try {
      const appTables = appDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[];
      for (const t of appTables) {
        if (SENSITIVE_TABLES.has(String(t.name))) continue; // hide users/sessions from the listing
        const c = appDb().prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get() as any;
        out.push({ db: "app", name: String(t.name), rows: Number(c?.c ?? 0) });
      }
    } catch { /* app db optional */ }
    return NextResponse.json({ tables: out });
  }

  // guard: only real table names, no injection
  const safe = /^[A-Za-z0-9_]+$/.test(table);
  if (!safe) return NextResponse.json({ error: "bad table" }, { status: 400 });
  // never expose credential/session tables, even to an authenticated admin
  if (SENSITIVE_TABLES.has(table)) return NextResponse.json({ error: "forbidden table" }, { status: 403 });

  if (db === "app") {
    const rows = appDb().prepare(`SELECT * FROM "${table}" LIMIT 200`).all() as any[];
    return NextResponse.json({ table, db, rows: norm(rows) });
  }
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "${table}" LIMIT 200`).catch(() => []);
  return NextResponse.json({ table, db, rows: norm(rows) });
}
