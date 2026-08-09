/**
 * Product-update broadcasts to registered users, via Resend (already the
 * site's mail provider — RESEND_API_KEY / NOTIFY_FROM_EMAIL).
 *
 * CONSENT IS THE FILTER: only users with mailing_consent=1 are addressed —
 * the same rule as the Rav Messer sync, because "registered" and "agreed to
 * email" are different facts even now that signup requires consent (old
 * accounts predate the requirement). Every message carries an opt-out line
 * pointing at /account, where the toggle actually works — an unsubscribe
 * promise without a mechanism is spam with better manners.
 *
 * Every send is recorded in `broadcasts` first (subject, body, counts):
 * history is what separates "did I already announce this?" from guessing,
 * and a crash mid-send leaves a row showing exactly how far it got.
 */
import { appDb } from "./appDb";
import { siteUrl } from "./share";

let ensured = false;
function ensureTable() {
  if (ensured) return;
  appDb().exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      recipients INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensured = true;
}

export function broadcastConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL);
}

export interface BroadcastRow {
  id: number; subject: string; recipients: number; sent: number; failed: number; created_at: string;
}

export function broadcastHistory(limit = 10): BroadcastRow[] {
  ensureTable();
  return appDb().prepare(
    "SELECT id, subject, recipients, sent, failed, created_at FROM broadcasts ORDER BY id DESC LIMIT ?"
  ).all(limit) as BroadcastRow[];
}

/** Simple paragraph-preserving HTML from operator-typed plain text. */
function toHtml(subject: string, body: string, accountUrl: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = esc(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br/>")}</p>`).join("");
  return `<!doctype html><html dir="rtl" lang="he"><body style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e2e8f0">
    <p style="margin:0 0 6px;font-size:12px;color:#6366f1;font-weight:bold">🦏 קרנף אנליסט</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${esc(subject)}</h1>
    <div style="font-size:14px;line-height:1.7;color:#334155">${paragraphs}</div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0 12px"/>
    <p style="margin:0;font-size:11px;color:#94a3b8">
      קיבלת עדכון זה כמשתמש רשום של קרנף אנליסט ·
      <a href="${accountUrl}" style="color:#6366f1">להסרה מרשימת הדיוור — עמוד החשבון שלך</a>
    </p>
  </div></body></html>`;
}

const BATCH = 90; // Resend's batch endpoint caps at 100 messages per call

export interface BroadcastReport {
  ok: boolean;
  recipients: number;
  sent: number;
  failed: number;
  errors: string[];
}

export async function sendBroadcast(subject: string, body: string): Promise<BroadcastReport> {
  ensureTable();
  const report: BroadcastReport = { ok: false, recipients: 0, sent: 0, failed: 0, errors: [] };
  if (!broadcastConfigured()) {
    report.errors.push("RESEND_API_KEY / NOTIFY_FROM_EMAIL not configured");
    return report;
  }
  const sub = subject.trim().slice(0, 200);
  const text = body.trim().slice(0, 20_000);
  if (!sub || !text) { report.errors.push("empty subject or body"); return report; }

  const users = appDb().prepare(
    "SELECT email, name FROM users WHERE mailing_consent=1 ORDER BY id"
  ).all() as Array<{ email: string; name: string }>;
  report.recipients = users.length;

  const rowId = Number(appDb().prepare(
    "INSERT INTO broadcasts (subject, body, recipients) VALUES (?, ?, ?)"
  ).run(sub, text, users.length).lastInsertRowid);

  const accountUrl = `${siteUrl()}/account`;
  const html = toHtml(sub, text, accountUrl);
  const from = process.env.NOTIFY_FROM_EMAIL!;

  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify(batch.map((u) => ({
          from, to: [u.email], subject: sub, html,
          text: `${text}\n\n—\nלהסרה מרשימת הדיוור: ${accountUrl}`,
        }))),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) report.sent += batch.length;
      else {
        report.failed += batch.length;
        if (report.errors.length < 5) report.errors.push(`batch ${i / BATCH + 1}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
      }
    } catch (e) {
      report.failed += batch.length;
      if (report.errors.length < 5) report.errors.push(`batch ${i / BATCH + 1}: ${e instanceof Error ? e.message : "network error"}`);
    }
  }

  appDb().prepare("UPDATE broadcasts SET sent=?, failed=? WHERE id=?").run(report.sent, report.failed, rowId);
  report.ok = report.failed === 0 && report.sent > 0;
  return report;
}
