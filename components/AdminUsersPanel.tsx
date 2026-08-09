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

export default function AdminUsersPanel({ stats, feedback, ravConfigured, crmConfigured }: {
  stats: AdminUserStats;
  feedback: AdminFeedbackRow[];
  ravConfigured: boolean;
  crmConfigured: boolean;
}) {
  const [reports, setReports] = useState<Record<string, SyncReport | "running">>({});
  const [approved, setApproved] = useState<Record<number, boolean>>({});

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
