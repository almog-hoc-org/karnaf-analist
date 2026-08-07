"use client";

import { useState, type ReactNode } from "react";

const TABS = [
  { key: "overview", label: "📊 סקירה" },
  { key: "deals", label: "🔎 דפדפן עסקאות" },
  { key: "users", label: "👥 משתמשים ודיוור" },
  { key: "reliability", label: "🛡️ בקרת אמינות" },
  { key: "logic", label: "🧮 לוגיקה ומתודולוגיה" },
  { key: "rules", label: "⚙️ חוקי המערכת" },
  { key: "tables", label: "🗄️ טבלאות המאגר" },
] as const;

export default function AdminTabs({ overview, reliability, logic, rules, deals, tables, users }: {
  overview: ReactNode; reliability: ReactNode; logic: ReactNode; rules: ReactNode; deals: ReactNode; tables: ReactNode; users: ReactNode;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("overview");
  const panes: Record<string, ReactNode> = { overview, reliability, logic, rules, deals, tables, users };

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
              tab === t.key ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      {panes[tab]}
    </>
  );
}
