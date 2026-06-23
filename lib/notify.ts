/**
 * Email notification framework.
 *
 * Provider: Resend (free tier: 3,000 emails/month).
 * Setup:
 *   1. Create a free account at https://resend.com
 *   2. Get an API key
 *   3. Add to .env.local:
 *        RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
 *        NOTIFY_TO_EMAIL=your@email.com
 *        NOTIFY_FROM_EMAIL=notifications@yourdomain.com  (must be verified in Resend)
 *
 * Without env vars, this module logs to console and skips sending — safe to run anywhere.
 */

export interface ReportNotification {
  title: string;             // Hebrew title of the new report
  source: string;            // Source name (e.g., "הלשכה המרכזית לסטטיסטיקה")
  url: string;               // Direct link to the report
  publishedAt: string;       // ISO date of publication
  summary?: string;          // 1-2 sentence summary
  systemUrl?: string;        // Link to the system showing imported data
}

interface NotifyConfig {
  apiKey: string | null;
  toEmail: string | null;
  fromEmail: string;
  enabled: boolean;
}

function loadConfig(): NotifyConfig {
  const apiKey = process.env.RESEND_API_KEY || null;
  const toEmail = process.env.NOTIFY_TO_EMAIL || null;
  const fromEmail = process.env.NOTIFY_FROM_EMAIL || "noreply@example.com";
  return {
    apiKey,
    toEmail,
    fromEmail,
    enabled: Boolean(apiKey && toEmail),
  };
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

function buildHtml(n: ReportNotification): string {
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Heebo', sans-serif; background: #f6f7fb; padding: 24px; }
  .card { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
  h1 { color: #0f172a; font-size: 22px; margin: 0 0 8px; }
  .badge { display: inline-block; background: #ecfeff; color: #0e7490; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  p { color: #475569; line-height: 1.6; margin: 12px 0; }
  .meta { color: #94a3b8; font-size: 12px; margin: 16px 0; }
  .btn { display: inline-block; background: #0891b2; color: white !important; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 4px 6px 4px 0; }
  .btn-secondary { background: white; color: #0891b2 !important; border: 1px solid #0891b2; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
  .footer { color: #94a3b8; font-size: 11px; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">📢 דוח חדש זוהה</span>
    <h1>${htmlEscape(n.title)}</h1>
    <p class="meta">
      <strong>מקור:</strong> ${htmlEscape(n.source)}<br/>
      <strong>פורסם:</strong> ${htmlEscape(n.publishedAt)}
    </p>
    ${n.summary ? `<p>${htmlEscape(n.summary)}</p>` : ""}
    <hr/>
    <div>
      <a href="${htmlEscape(n.url)}" class="btn">📄 צפה בדוח המקורי</a>
      ${n.systemUrl ? `<a href="${htmlEscape(n.systemUrl)}" class="btn btn-secondary">🔗 פתח במערכת</a>` : ""}
    </div>
    <hr/>
    <p class="footer">מערכת מחקר נדל"ן ישראל · נשלח אוטומטית ע"י סקריפט ניטור</p>
  </div>
</body>
</html>
`;
}

/**
 * Send a notification email. If RESEND_API_KEY isn't set, logs to console.
 * Returns true if sent successfully or logged (always returns truthy unless an actual API error).
 */
export async function sendReportNotification(n: ReportNotification): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const cfg = loadConfig();

  if (!cfg.enabled) {
    console.log("📧 [NOTIFY:console] New report detected — RESEND_API_KEY not configured.");
    console.log(`     Title: ${n.title}`);
    console.log(`     Source: ${n.source}`);
    console.log(`     URL: ${n.url}`);
    if (n.systemUrl) console.log(`     System: ${n.systemUrl}`);
    return { sent: false, reason: "RESEND_API_KEY or NOTIFY_TO_EMAIL not set in env" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.fromEmail,
        to: cfg.toEmail,
        subject: `📢 דוח חדש: ${n.title}`,
        html: buildHtml(n),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`📧 [NOTIFY:error] Resend API ${res.status}: ${errText}`);
      return { sent: false, reason: `Resend API error: ${res.status}` };
    }

    console.log(`📧 [NOTIFY:sent] "${n.title}" → ${cfg.toEmail}`);
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`📧 [NOTIFY:exception] ${msg}`);
    return { sent: false, reason: msg };
  }
}

export function isNotifyConfigured(): boolean {
  return loadConfig().enabled;
}
