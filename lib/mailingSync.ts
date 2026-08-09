/**
 * Manual, admin-triggered sync of registered users to the two outside systems:
 *
 *   Rav Messer (responder.co.il)  — the mailing list. ONLY users who ticked
 *     mailing consent at registration are sent; everyone else never leaves
 *     the box. Re-running is safe: rows are marked ravmesser_synced_at and
 *     skipped next time (upsert on their side makes double-sends harmless).
 *
 *   karnaf-crm  — the business CRM (Supabase Edge Function
 *     `website-leads-intake`). That endpoint REQUIRES name+phone, so only
 *     users who provided a phone are sent, with source "analyst-signup" so
 *     they route to the right track inside the CRM.
 *
 * Deliberately manual (a button in the admin panel), per the operator's
 * decision: no background job quietly ships user data anywhere. Both targets
 * fail-soft per user — one bad row doesn't abort the batch — and report
 * {synced, skipped, failed} back to the UI.
 *
 * Configuration (all server-side env):
 *   RAVMESSER_API_KEY   – API access token
 *   RAVMESSER_LIST_ID   – numeric list id to subscribe into
 *   CRM_INTAKE_URL      – full URL of the CRM's website-leads-intake function
 */
import { appDb } from "./appDb";

interface SyncableUser {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  created_at: string;
}

export interface SyncReport {
  target: "ravmesser" | "crm";
  configured: boolean;
  candidates: number;
  synced: number;
  failed: number;
  errors: string[]; // first few, for the admin UI
}

function pushErr(report: SyncReport, msg: string) {
  report.failed++;
  if (report.errors.length < 5) report.errors.push(msg);
}

/* ── Rav Messer ──────────────────────────────────────────────────────────── */

export function ravMesserConfigured(): boolean {
  return !!(process.env.RAVMESSER_API_KEY && process.env.RAVMESSER_LIST_ID);
}

/**
 * Wire format verified against Rav Messer's OFFICIAL Postman collection
 * (github.com/responder/restapi, "Responder API Example"):
 *
 *   POST https://api.responder.co.il/main/lists/{listId}/subscribers
 *   Authorization: <token as-is — no "Bearer " prefix in their examples>
 *   Content-Type: application/x-www-form-urlencoded
 *   subscribers=[{"NAME":"...","PHONE":"...","EMAIL":"..."}]   ← JSON ARRAY in a form field
 *
 * The array body means batching is native — one request per chunk, not per user.
 */
const RAVMESSER_BATCH = 100;

export async function syncToRavMesser(): Promise<SyncReport> {
  const report: SyncReport = { target: "ravmesser", configured: ravMesserConfigured(), candidates: 0, synced: 0, failed: 0, errors: [] };
  if (!report.configured) return report;

  const rows = appDb().prepare(
    `SELECT id, email, name, phone, created_at FROM users
      WHERE mailing_consent=1 AND ravmesser_synced_at IS NULL ORDER BY id`
  ).all() as SyncableUser[];
  report.candidates = rows.length;

  const listId = process.env.RAVMESSER_LIST_ID!;
  const key = process.env.RAVMESSER_API_KEY!;
  for (let i = 0; i < rows.length; i += RAVMESSER_BATCH) {
    const batch = rows.slice(i, i + RAVMESSER_BATCH);
    const payload = batch.map((u) => ({ NAME: u.name, EMAIL: u.email, ...(u.phone ? { PHONE: u.phone } : {}) }));
    try {
      const res = await fetch(`https://api.responder.co.il/main/lists/${encodeURIComponent(listId)}/subscribers`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: key },
        body: new URLSearchParams({ subscribers: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const mark = appDb().prepare("UPDATE users SET ravmesser_synced_at=datetime('now') WHERE id=?");
        for (const u of batch) mark.run(u.id);
        report.synced += batch.length;
      } else {
        const text = (await res.text().catch(() => "")).slice(0, 120);
        pushErr(report, `batch ${i / RAVMESSER_BATCH + 1}: HTTP ${res.status} ${text}`);
        report.failed += batch.length - 1; // pushErr counted one
      }
    } catch (e) {
      pushErr(report, `batch ${i / RAVMESSER_BATCH + 1}: ${e instanceof Error ? e.message : "network error"}`);
      report.failed += batch.length - 1;
    }
  }
  return report;
}

/* ── karnaf-crm ──────────────────────────────────────────────────────────── */

export function crmConfigured(): boolean {
  return !!process.env.CRM_INTAKE_URL;
}

export async function syncToCrm(): Promise<SyncReport> {
  const report: SyncReport = { target: "crm", configured: crmConfigured(), candidates: 0, synced: 0, failed: 0, errors: [] };
  if (!report.configured) return report;

  // phone is REQUIRED by the intake endpoint — email-only users stay local
  const rows = appDb().prepare(
    `SELECT id, email, name, phone, created_at FROM users
      WHERE phone IS NOT NULL AND phone != '' AND crm_synced_at IS NULL ORDER BY id`
  ).all() as SyncableUser[];
  report.candidates = rows.length;

  for (const u of rows) {
    try {
      const res = await fetch(process.env.CRM_INTAKE_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: u.name,
          phone: u.phone,
          email: u.email,
          source: "analyst-signup",
          message: `נרשם לקרנף אנליסט ב-${u.created_at}`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        appDb().prepare("UPDATE users SET crm_synced_at=datetime('now') WHERE id=?").run(u.id);
        report.synced++;
      } else {
        pushErr(report, `${u.email}: HTTP ${res.status}`);
      }
    } catch (e) {
      pushErr(report, `${u.email}: ${e instanceof Error ? e.message : "network error"}`);
    }
  }
  return report;
}

/* ── CSV fallback (always available, no config) ──────────────────────────── */

export function consentingUsersCsv(): string {
  const rows = appDb().prepare(
    `SELECT email, name, phone, mailing_consent, created_at, ravmesser_synced_at, crm_synced_at
       FROM users ORDER BY id`
  ).all() as Array<Record<string, unknown>>;
  // Quote-escape AND neutralise formula prefixes: a user who registers with
  // the name `=HYPERLINK(...)` must not become an executable cell on the
  // operator's machine when the CSV opens in Excel/Sheets.
  const esc = (v: unknown) => {
    let s = String(v ?? "").replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s}"`;
  };
  const header = "email,name,phone,mailing_consent,created_at,ravmesser_synced_at,crm_synced_at";
  return [header, ...rows.map((r) => [r.email, r.name, r.phone, r.mailing_consent, r.created_at, r.ravmesser_synced_at, r.crm_synced_at].map(esc).join(","))].join("\n");
}
