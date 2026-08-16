"use client";

/**
 * Admin tab: registered users, mailing sync, and feedback approval.
 *
 * The sync buttons call /api/admin/sync-mailing and render the report inline —
 * synced/failed counts and the first errors — because a sync button that just
 * says "done" hides exactly the failures the operator needs to see.
 * Feedback approval is what releases the feedback credit bonus (the API is
 * idempotent, so a double-click cannot double-credit).
 */
import { useState } from "react";
import { withBasePath } from "@/lib/basePath";

export interface AdminUserStats {
  total: number;
  consenting: number;
  withPhone: number;
  unsyncedRavmesser: number;
  unsyncedCrm: number;
  creditsInCirculation: number; // whole credits
}

export interface AdminFeedbackRow {
  id: number;
  kind: string;
  message: string;
  city: string | null;
  email: string | null;
  hasUser: boolean;
  approved: boolean;
  created_at: string;
}

interface SyncReport {
  target: string;
  configured: boolean;
  candidates: number;
  synced: number;
  failed: number;
  errors: string[];
}

export interface AdminUserListRow {
  id: number; email: string; name: string; phone: string | null;
  mailing_consent: number; google_id: string | null; created_at: string;
  credits: number; unlimited: boolean; deals: number; last_seen: string | null;
}

export interface BroadcastHistoryRow {
  id: number; subject: string; recipients: number; sent: number; failed: number; created_at: string;
}

export default function AdminUsersPanel({ stats, feedback, ravConfigured, crmConfigured, users, broadcastConfigured, broadcastHistory }: {
  stats: AdminUserStats;
  feedback: AdminFeedbackRow[];
  ravConfigured: boolean;
  crmConfigured: boolean;
  users: AdminUserListRow[];
  broadcastConfigured: boolean;
  broadcastHistory: BroadcastHistoryRow[];
}) {
  const [reports, setReports] = useState<Record<string, SyncReport | "running">>({});
  const [approved, setApproved] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bcSubject, setBcSubject] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcReport, setBcReport] = useState<string | null>(null);

  async function userAction(action: string, userId: number, extra: Record<string, unknown> = {}) {
    setBusy(`${action}:${userId}`);
    setNotice(null);
    try {
      const res = await fetch(withBasePath("/api/admin/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) setNotice(`שגיאה: ${data.error ?? res.status}`);
      else if (action === "reset_password") setNotice(`סיסמה זמנית למשתמש #${userId}: ${data.tempPassword} — מוצגת פעם אחת, העבר למשתמש עכשיו`);
      else { setNotice("בוצע ✓ — רענן את העמוד לתצוגה מעודכנת"); }
    } catch { setNotice("שגיאת רשת"); }
    setBusy(null);
  }

  async function sendBc() {
    if (!bcSubject.trim() || !bcBody.trim()) { setBcReport("חסר נושא או תוכן"); return; }
    if (!confirm(`לשלוח את "${bcSubject}" לכל המשתמשים שהסכימו לדיוור?`)) return;
    setBusy("broadcast"); setBcReport("שולח…");
    try {
      const res = await fetch(withBasePath("/api/admin/broadcast"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: bcSubject, body: bcBody }),
      });
      const d = await res.json();
      setBcReport(d.errors?.length ? `נשלחו ${d.sent}/${d.recipients} · שגיאות: ${d.errors.join(" · ")}` : `נשלחו ${d.sent} מתוך ${d.recipients} נמענים ✓`);
      if (d.ok) { setBcSubject(""); setBcBody(""); }
    } catch { setBcReport("שגיאת רשת"); }
    setBusy(null);
  }

  async function runSync(target: "ravmesser" | "crm") {
    setReports((r) => ({ ...r, [target]: "running" }));
    try {
      const res = await fetch(withBasePath("/api/admin/sync-mailing"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      setReports((r) => ({ ...r, [target]: data }));
    } catch {
      setReports((r) => ({ ...r, [target]: { target, configured: true, candidates: 0, synced: 0, failed: 1, errors: ["network error"] } }));
    }
  }

  async function approve(id: number) {
    setApproved((a) => ({ ...a, [id]: true })); // optimistic — the API is idempotent
    try {
      await fetch(withBasePath("/api/admin/feedback-approve"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch { /* the optimistic tick stays; a refresh shows the truth */ }
  }

  const card = "rounded-2xl border border-slate-200 bg-white p-5";
  const renderReport = (r: SyncReport | "running" | undefined) => {
    if (!r) return null;
    if (r === "running") return <p className="mt-2 text-xs text-slate-500">מסנכרן…</p>;
    if (!r.configured) return <p className="mt-2 text-xs font-bold text-amber-600">לא מוגדר — חסרים משתני סביבה (ראה תיעוד בקובץ lib/mailingSync.ts)</p>;
    return (
      <div className="mt-2 text-xs text-slate-600">
        <p>מועמדים: {r.candidates} · סונכרנו: <b className="text-emerald-600">{r.synced}</b> · נכשלו: <b className={r.failed ? "text-red-500" : ""}>{r.failed}</b></p>
        {r.errors.map((e, i) => <p key={i} className="text-red-500" dir="ltr">{e}</p>)}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* user stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ["משתמשים רשומים", stats.total],
          ["הסכימו לדיוור", stats.consenting],
          ["עם טלפון", stats.withPhone],
          ["ממתינים לרב מסר", stats.unsyncedRavmesser],
          ["ממתינים ל-CRM", stats.unsyncedCrm],
          ["קרדיטים במחזור", stats.creditsInCirculation],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-2xl font-black text-slate-900">{value}</p>
            <p className="mt-1 text-2xs font-bold text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      {notice && (
        <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-bold text-indigo-800" dir="rtl">{notice}</p>
      )}

      {/* users table */}
      <section className={card}>
        <h3 className="text-sm font-bold text-slate-900">👥 המשתמשים במערכת</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="table-pin-first w-full min-w-[820px] text-xs" dir="rtl">
            <thead className="text-2xs font-bold text-slate-400">
              <tr>
                <th className="py-1.5 pl-2 text-right">משתמש</th>
                <th className="text-right">טלפון</th>
                <th className="text-center">דיוור</th>
                <th className="text-center">גוגל</th>
                <th className="text-center">קרדיטים</th>
                <th className="text-center">עסקאות</th>
                <th className="text-right">נרשם</th>
                <th className="text-right">נראה לאחרונה</th>
                <th className="text-left">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="py-2 pl-2">
                    <p className="font-bold text-slate-800">{u.name}</p>
                    <p className="text-2xs text-slate-400" dir="ltr">{u.email}</p>
                  </td>
                  <td dir="ltr" className="text-right text-slate-600">{u.phone ?? "—"}</td>
                  <td className="text-center">{u.mailing_consent ? "✅" : "—"}</td>
                  <td className="text-center">{u.google_id ? "🟢" : "—"}</td>
                  <td className="text-center font-bold tabular-nums">
                    {u.unlimited
                      ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-black text-amber-800" title="גישה ללא הגבלה — הקרדיטים לא רלוונטיים לחשבון הזה">∞</span>
                      : Number.isInteger(u.credits) ? u.credits : u.credits.toFixed(1)}
                  </td>
                  <td className="text-center tabular-nums">{u.deals}</td>
                  <td className="text-right text-2xs text-slate-400" dir="ltr">{u.created_at?.slice(0, 10)}</td>
                  <td className="text-right text-2xs text-slate-400" dir="ltr">{u.last_seen?.slice(0, 10) ?? "—"}</td>
                  <td className="py-2 text-left">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button disabled={!!busy} onClick={() => userAction("reset_password", u.id)}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-2xs font-bold text-slate-600 hover:bg-slate-50" title="איפוס סיסמה — מייצר סיסמה זמנית ומנתק את המשתמש מכל המכשירים">
                        🔑 איפוס
                      </button>
                      <button disabled={!!busy} onClick={() => {
                        const v = prompt("כמה קרדיטים להוסיף? (מספר שלילי מוריד)", "5");
                        if (v && Number(v)) userAction("adjust_credits", u.id, { credits: Number(v), note: "עדכון ידני מהאדמין" });
                      }} className="rounded-lg border border-slate-200 px-2 py-1 text-2xs font-bold text-slate-600 hover:bg-slate-50">
                        🪙 קרדיטים
                      </button>
                      <button disabled={!!busy} onClick={() => {
                        const next = !u.unlimited;
                        const msg = next
                          ? `לתת ל-${u.email} גישה ללא הגבלה? כל הערים ייפתחו לו לצמיתות, בלי לצרוך קרדיטים.`
                          : `לבטל ל-${u.email} את הגישה ללא ההגבלה? הוא יחזור למודל הקרדיטים הרגיל.`;
                        if (confirm(msg)) userAction("set_unlimited", u.id, { unlimited: next });
                      }} className={`rounded-lg border px-2 py-1 text-2xs font-bold ${
                        u.unlimited ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`} title={u.unlimited ? "לבטל גישה ללא הגבלה" : "לתת גישה ללא הגבלה"}>
                        ∞ ללא הגבלה
                      </button>
                      <button disabled={!!busy} onClick={() => userAction("set_consent", u.id, { consent: !u.mailing_consent })}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-2xs font-bold text-slate-600 hover:bg-slate-50" title="הפעלה/כיבוי הסכמת דיוור">
                        📧 דיוור
                      </button>
                      <button disabled={!!busy} onClick={() => {
                        if (confirm(`למחוק את ${u.email}? כל העסקאות, הקרדיטים וההיסטוריה שלו יימחקו לצמיתות.`)) userAction("delete", u.id);
                      }} className="rounded-lg border border-red-100 px-2 py-1 text-2xs font-bold text-red-500 hover:bg-red-50">
                        🗑 מחק
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button disabled={!!busy} onClick={() => {
          const email = prompt("אימייל של המשתמש החדש:"); if (!email) return;
          const name = prompt("שם מלא:"); if (!name) return;
          const password = prompt("סיסמה (10+ תווים):"); if (!password) return;
          const phone = prompt("טלפון (לא חובה):") ?? "";
          fetch(withBasePath("/api/admin/users"), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create", email, name, password, phone }),
          }).then(async (r) => {
            const d = await r.json();
            setNotice(r.ok ? `נוצר משתמש ✓ (10 קרדיטים) — רענן את העמוד` : `שגיאה: ${d.error}`);
          }).catch(() => setNotice("שגיאת רשת"));
        }} className="mt-3 rounded-xl border border-dashed border-indigo-300 px-4 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50">
          + הוסף משתמש
        </button>
      </section>

      {/* broadcast composer */}
      <section className={card}>
        <h3 className="text-sm font-bold text-slate-900">📣 דיוור עדכונים לכל המשתמשים</h3>
        <p className="mt-1 text-xs text-slate-500">
          נשלח דרך Resend לכל מי שהסכים לדיוור ({stats.consenting} כרגע), עם קישור הסרה אוטומטי. מתאים לעדכוני גרסה, פיצ׳רים חדשים והודעות מערכת.
          {!broadcastConfigured && <b className="text-amber-600"> ⚠ חסר RESEND_API_KEY / NOTIFY_FROM_EMAIL בשרת.</b>}
        </p>
        <input value={bcSubject} onChange={(e) => setBcSubject(e.target.value)} placeholder="נושא — למשל: חדש בקרנף אנליסט: מחשבון תמהיל משכנתא"
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
        <textarea value={bcBody} onChange={(e) => setBcBody(e.target.value)} rows={6}
          placeholder={"תוכן ההודעה (טקסט חופשי; שורה ריקה = פסקה חדשה)"}
          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none" />
        <div className="mt-2 flex items-center gap-3">
          <button disabled={!!busy || !broadcastConfigured} onClick={sendBc}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            שלח לכל המסכימים
          </button>
          {bcReport && <span className="text-xs font-semibold text-slate-600">{bcReport}</span>}
        </div>
        {broadcastHistory.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-2xs text-slate-500">
            {broadcastHistory.map((b) => (
              <li key={b.id}>
                <span dir="ltr">{b.created_at?.slice(0, 16)}</span> · <b className="text-slate-700">{b.subject}</b> · נשלחו {b.sent}/{b.recipients}{b.failed ? ` · נכשלו ${b.failed}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* sync actions */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className={card}>
          <h3 className="text-sm font-bold text-slate-900">📧 רב מסר</h3>
          <p className="mt-1 text-xs text-slate-500">שולח לרשימת התפוצה רק משתמשים שסימנו הסכמת דיוור וטרם סונכרנו.</p>
          <button onClick={() => runSync("ravmesser")} disabled={reports.ravmesser === "running"}
            className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            סנכרן לרב מסר {ravConfigured ? "" : "(לא מוגדר)"}
          </button>
          {renderReport(reports.ravmesser)}
        </div>
        <div className={card}>
          <h3 className="text-sm font-bold text-slate-900">🦏 karnaf-crm</h3>
          <p className="mt-1 text-xs text-slate-500">שולח ל-CRM את כל הנרשמים החדשים — גם אימייל-בלבד — מתויגים ״קרנף אנליסט״, במקור analyst-signup.</p>
          <button onClick={() => runSync("crm")} disabled={reports.crm === "running"}
            className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            סנכרן ל-CRM {crmConfigured ? "" : "(לא מוגדר)"}
          </button>
          {renderReport(reports.crm)}
        </div>
        <div className={card}>
          <h3 className="text-sm font-bold text-slate-900">📄 ייצוא CSV</h3>
          <p className="mt-1 text-xs text-slate-500">כל המשתמשים עם מצב הסכמה וסנכרון — הגיבוי שתמיד עובד, בלי שום הגדרה.</p>
          <a href={withBasePath("/api/admin/sync-mailing?export=csv")}
            className="mt-3 inline-block rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
            הורד CSV
          </a>
        </div>
      </section>

      {/* feedback approval */}
      <section className={card}>
        <h3 className="text-sm font-bold text-slate-900">💬 משוב ממתין לאישור</h3>
        <p className="mt-1 text-xs text-slate-500">
          אישור משוב של משתמש רשום מזכה אותו בבונוס הקרדיטים (חד-פעמי למשתמש). משוב אנונימי אפשר לאשר לצורך מעקב — פשוט אין את מי לזכות.
        </p>
        {feedback.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">אין משוב ממתין.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {feedback.map((f) => {
              const isApproved = f.approved || approved[f.id];
              return (
                <li key={f.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-bold text-slate-700">
                      {f.kind}{f.city ? ` · ${f.city}` : ""}{f.email ? ` · ${f.email}` : ""}{f.hasUser ? " · משתמש רשום ✓" : " · אנונימי"}
                      <span className="mr-2 font-normal text-slate-400" dir="ltr">{f.created_at.slice(0, 10)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-600">{f.message || "(ללא טקסט)"}</p>
                  </div>
                  <button
                    onClick={() => approve(f.id)}
                    disabled={isApproved}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold ${
                      isApproved ? "bg-emerald-50 text-emerald-600" : "bg-indigo-600 text-white hover:bg-indigo-700"
                    }`}
                  >
                    {isApproved ? "אושר ✓" : "אשר"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
