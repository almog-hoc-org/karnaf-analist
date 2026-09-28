/**
 * The weekly OPERATOR report — the numbers that say whether the site is
 * healthy and whether it is working as a product.
 *
 * Until 28.9.2026 this report was assembled by hand (an agent reading the
 * database) and mailed once. It is now a unit (deploy/karnaf-ops-report.timer,
 * Sunday 07:00) built from the same tables the admin dashboard reads.
 *
 * This file is PURE: it turns an already-gathered snapshot into a subject, a
 * plain-text body and an RTL HTML body. scripts/send-ops-report.ts gathers the
 * snapshot. Keeping the two apart is what makes the wording testable.
 *
 * The rule the report follows: every section ends in what to DO, and a number
 * is only printed when it changes what the operator does.
 */

export interface OpsSnapshot {
  generatedAt: string; // ISO
  health: {
    httpOk: boolean | null; // /api/status reachable and 200
    problems: string[];
    warnings: string[];
    latestDealDate: string | null;
    latestDealAgeDays: number | null;
    pipelineAgeHours: number | null;
    collectionAgeHours: number | null;
  };
  users: { total: number; new7: number; new30: number; consenting: number; referred30: number };
  usage7: { sessions: number; signedInUsers: number; pageViews: number };
  funnel7: { checks: number; verdicts: number; unlocks: number; signups: number; shares: number };
  credits: { granted30: number; spent30: number; outstanding: number; usersWithBalance: number };
  search7: { searches: number; misses: number; topMisses: Array<{ term: string; n: number }> };
  feedbackOpen: Array<{ id: number; kind: string; city: string | null; message: string; createdAt: string }>;
  topCities7: Array<{ city: string; n: number }>;
}

export interface OpsReport { subject: string; text: string; html: string; alerts: string[] }

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const fmt = (n: number) => n.toLocaleString("he-IL");

/** What needs the operator this week, most urgent first. Pure; tested. */
export function opsAlerts(s: OpsSnapshot): string[] {
  const out: string[] = [];
  if (s.health.httpOk === false) out.push("האתר לא ענה לבדיקת המצב — לבדוק שהקונטיינר רץ ושהדומיין מחזיר 200.");
  for (const p of s.health.problems) out.push(`תקלה: ${p}`);
  if (s.health.latestDealAgeDays != null && s.health.latestDealAgeDays > 21) {
    out.push(`העסקה האחרונה במאגר בת ${s.health.latestDealAgeDays} ימים — להריץ את רענון העסקאות.`);
  }
  if (s.search7.searches >= 20 && s.search7.misses / s.search7.searches > 0.2) {
    out.push(`${pct(s.search7.misses, s.search7.searches)} מהחיפושים לא מצאו כלום — לעבור על המילים ברשימה.`);
  }
  if (s.feedbackOpen.length) out.push(`${s.feedbackOpen.length} משובים ממתינים לטיפול.`);
  if (s.funnel7.unlocks > 0 && s.funnel7.shares === 0) out.push("היו פתיחות עיר ואף שיתוף — מנוע ההפצה לא עובד.");
  return out;
}

export function buildOpsReport(s: OpsSnapshot): OpsReport {
  const alerts = opsAlerts(s);
  const date = new Date(s.generatedAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
  const subject = alerts.length
    ? `קרנף אנליסט · דוח שבועי ${date} · ${alerts.length} לטיפול`
    : `קרנף אנליסט · דוח שבועי ${date} · הכל תקין`;

  const sections: Array<[string, string[]]> = [
    ["מה לעשות השבוע", alerts.length ? alerts : ["אין פריטים דחופים."]],
    ["בריאות", [
      `האתר: ${s.health.httpOk == null ? "לא נבדק" : s.health.httpOk ? "עונה" : "לא עונה"}`,
      `עסקה אחרונה: ${s.health.latestDealDate ?? "—"}${s.health.latestDealAgeDays != null ? ` (לפני ${s.health.latestDealAgeDays} ימים)` : ""}`,
      `צינור לילי אחרון: ${s.health.pipelineAgeHours != null ? `לפני ${Math.round(s.health.pipelineAgeHours)} שעות` : "—"}`,
      `איסוף לילי אחרון: ${s.health.collectionAgeHours != null ? `לפני ${Math.round(s.health.collectionAgeHours)} שעות` : "—"}`,
      ...s.health.warnings.map((w) => `אזהרה: ${w}`),
    ]],
    ["משתמשים", [
      `סה״כ ${fmt(s.users.total)} · חדשים ${s.users.new7} השבוע, ${s.users.new30} ב-30 יום`,
      `מסכימים לדיוור: ${fmt(s.users.consenting)} · הגיעו מהפניה ב-30 יום: ${s.users.referred30}`,
    ]],
    ["השבוע באתר", [
      `${fmt(s.usage7.sessions)} ביקורים · ${fmt(s.usage7.pageViews)} צפיות · ${s.usage7.signedInUsers} משתמשים מחוברים`,
      `בדיקות מחיר ${s.funnel7.checks} → פסקי דין ${s.funnel7.verdicts} · הרשמות ${s.funnel7.signups} · פתיחות עיר ${s.funnel7.unlocks} · שיתופים ${s.funnel7.shares}`,
    ]],
    ["קרדיטים", [
      `ב-30 יום: הוענקו ${fmt(s.credits.granted30)}, נוצלו ${fmt(s.credits.spent30)}`,
      `יתרה שלא נוצלה: ${fmt(s.credits.outstanding)} אצל ${s.credits.usersWithBalance} משתמשים`,
    ]],
    ["חיפושים בלי תוצאה", [
      `${s.search7.misses} מתוך ${s.search7.searches} (${pct(s.search7.misses, s.search7.searches)})`,
      ...(s.search7.topMisses.length ? [s.search7.topMisses.map((m) => `"${m.term}" ×${m.n}`).join(" · ")] : []),
    ]],
    ["ערים עם עניין", [s.topCities7.length ? s.topCities7.map((c) => `${c.city} ${c.n}`).join(" · ") : "—"]],
    ["משוב פתוח", s.feedbackOpen.length
      ? s.feedbackOpen.map((f) => `#${f.id} ${f.kind}${f.city ? ` · ${f.city}` : ""}: ${f.message.slice(0, 160)}`)
      : ["אין."]],
  ];

  const text = sections.map(([h, lines]) => `${h}\n${lines.map((l) => `• ${l}`).join("\n")}`).join("\n\n");
  const esc = (x: string) => x.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const html =
    `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1b2230;max-width:640px">` +
    sections.map(([h, lines], i) =>
      `<h3 style="margin:${i ? 18 : 0}px 0 6px;font-size:15px;${i === 0 && alerts.length ? "color:#b45309" : ""}">${esc(h)}</h3>` +
      `<ul style="margin:0;padding-inline-start:18px">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
    ).join("") +
    `</div>`;
  return { subject, text, html, alerts };
}
