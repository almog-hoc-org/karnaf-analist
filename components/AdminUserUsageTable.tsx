"use client";

import { useState } from "react";
import type { UserUsageRow, UserUsageDetail } from "@/lib/events";

/**
 * Usage per registered user, with a per-user drill-down.
 *
 * Client component only because a row expands. The rows themselves are
 * rendered from data the server already read — expanding fetches ONE user's
 * detail on demand rather than shipping every user's page list and search
 * history to the browser up front, which for a few hundred accounts would be
 * most of the event log travelling to a screen where almost none of it is
 * looked at.
 *
 * The whole panel sits behind the admin gate. What it shows about a person is
 * exactly what the privacy notice says is collected: pages, time, searches,
 * device class. There is no IP and no user-agent here because there is none in
 * the database.
 */

const DEVICE_HE: Record<string, string> = { mobile: "📱 מובייל", tablet: "📲 טאבלט", desktop: "💻 מחשב" };

/** "4 דק׳ 12 שנ׳" — an admin reading a table wants a duration, not 252. */
export function humanSeconds(total: number): string {
  if (!total) return "—";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} שע׳ ${m} דק׳`;
  if (m) return `${m} דק׳ ${s} שנ׳`;
  return `${s} שנ׳`;
}

export default function AdminUserUsageTable({ rows, days }: { rows: UserUsageRow[]; days: number }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<number, UserUsageDetail | "loading">>({});

  const toggle = async (userId: number) => {
    if (openId === userId) { setOpenId(null); return; }
    setOpenId(userId);
    if (detail[userId]) return;
    setDetail((d) => ({ ...d, [userId]: "loading" }));
    try {
      const res = await fetch(`/api/admin/usage?userId=${userId}&days=${days}`);
      const json = (await res.json()) as UserUsageDetail;
      setDetail((d) => ({ ...d, [userId]: json }));
    } catch {
      setDetail((d) => ({ ...d, [userId]: { pages: [], searches: [], devices: [] } }));
    }
  };

  if (!rows.length) {
    return (
      <p className="mt-2 text-xs text-slate-400">
        אין עדיין פעילות של משתמשים רשומים בתקופה. השורות כאן מופיעות אחרי שמשתמש מחובר גולש באתר —
        גלישה אנונימית נספרת בסיכום למעלה ולא כאן.
      </p>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-2xs font-bold text-slate-400">
          <tr>
            <th scope="col" className="py-1 text-right">משתמש</th>
            <th scope="col" className="py-1 text-left">זמן באתר</th>
            <th scope="col" className="py-1 text-left">עמודים</th>
            <th scope="col" className="py-1 text-left">ביקורים</th>
            <th scope="col" className="py-1 text-left">חיפושים</th>
            <th scope="col" className="py-1 text-center">מכשיר</th>
            <th scope="col" className="py-1 text-left">לאחרונה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = detail[r.userId];
            return (
              <tr key={r.userId} className="border-t border-slate-100 align-top">
                <td colSpan={7} className="p-0">
                  <button
                    type="button"
                    onClick={() => toggle(r.userId)}
                    aria-expanded={openId === r.userId}
                    className="grid w-full grid-cols-[minmax(0,1fr)_repeat(4,72px)_92px_100px] items-center gap-x-2 px-1 py-2 text-right hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-900">{r.name}</span>
                      <span className="block truncate text-2xs text-slate-400" dir="ltr">{r.email}</span>
                    </span>
                    <span className="text-left font-bold tabular-nums text-indigo-700">{humanSeconds(r.totalSeconds)}</span>
                    <span className="text-left tabular-nums text-slate-700">{r.pageViews.toLocaleString("he-IL")}</span>
                    <span className="text-left tabular-nums text-slate-500">{r.sessions.toLocaleString("he-IL")}</span>
                    <span className="text-left tabular-nums text-slate-500">{r.searches.toLocaleString("he-IL")}</span>
                    <span className="text-center text-2xs text-slate-600">{r.device ? DEVICE_HE[r.device] ?? r.device : "—"}</span>
                    <span className="text-left text-2xs tabular-nums text-slate-400" dir="ltr">
                      {r.lastSeen ? r.lastSeen.slice(0, 16).replace("T", " ") : "—"}
                    </span>
                  </button>

                  {openId === r.userId && (
                    <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      {d === "loading" || d === undefined ? (
                        <p className="text-xs text-slate-400">טוען…</p>
                      ) : (
                        <div className="grid gap-5 lg:grid-cols-2">
                          <div>
                            <h4 className="text-2xs font-black uppercase tracking-wide text-slate-500">עמודים שבהם צפה</h4>
                            {d.pages.length === 0 ? (
                              <p className="mt-1 text-xs text-slate-400">אין צפיות מתועדות בתקופה.</p>
                            ) : (
                              <table className="mt-2 w-full text-2xs">
                                <thead className="text-slate-400">
                                  <tr>
                                    <th scope="col" className="text-right font-bold">עמוד</th>
                                    <th scope="col" className="text-left font-bold">כניסות</th>
                                    <th scope="col" className="text-left font-bold">זמן ממוצע</th>
                                    <th scope="col" className="text-left font-bold">סה״כ</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {d.pages.map((p) => (
                                    <tr key={p.path} className="border-t border-slate-200/70">
                                      <td className="max-w-[240px] truncate py-1 text-right text-slate-700" dir="ltr" title={p.path}>
                                        {decodeURIComponent(p.path)}
                                      </td>
                                      <td className="py-1 text-left tabular-nums text-slate-500">{p.views}</td>
                                      <td className="py-1 text-left tabular-nums text-slate-600">{humanSeconds(p.avgSeconds)}</td>
                                      <td className="py-1 text-left font-bold tabular-nums text-slate-800">{humanSeconds(p.totalSeconds)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>

                          <div>
                            <h4 className="text-2xs font-black uppercase tracking-wide text-slate-500">מה חיפש</h4>
                            {d.searches.length === 0 ? (
                              <p className="mt-1 text-xs text-slate-400">לא ביצע חיפושים בתקופה.</p>
                            ) : (
                              <ul className="mt-2 flex flex-wrap gap-1.5">
                                {d.searches.map((sq) => (
                                  <li
                                    key={sq.term}
                                    className={`rounded-lg border px-2 py-1 text-2xs ${
                                      sq.found
                                        ? "border-slate-200 bg-white text-slate-700"
                                        : "border-amber-200 bg-amber-50 text-amber-800"
                                    }`}
                                    title={sq.found ? "נמצאו תוצאות" : "לא נמצאו תוצאות — צורך שלא כוסה"}
                                  >
                                    {sq.term}
                                    {sq.n > 1 && <span className="ms-1 text-slate-400">×{sq.n}</span>}
                                    {!sq.found && <span className="ms-1">⚠</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {d.devices.length > 0 && (
                              <p className="mt-3 text-2xs text-slate-500">
                                מכשירים: {d.devices.map((x) => `${DEVICE_HE[x.device] ?? x.device} (${x.n})`).join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
