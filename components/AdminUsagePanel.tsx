"use client";

import { useEffect, useState } from "react";
import Overview from "@/components/admin/usage/Overview";
import Conversion from "@/components/admin/usage/Conversion";
import Engagement from "@/components/admin/usage/Engagement";
import Content from "@/components/admin/usage/Content";
import Quality from "@/components/admin/usage/Quality";
import type { UsagePayload } from "@/lib/usagePayload";

/**
 * Admin tab: what visitors do, and where the product loses them.
 *
 * THIS FILE IS THE SHELL ONLY — loading, the date range, and the sub-tabs. The
 * panels live under components/admin/usage/. It had grown past 700 lines with
 * fourteen cards inline, at which point changing one card meant re-reading the
 * whole dashboard.
 *
 * THE ORDER OF THE TABS IS THE ARGUMENT, and it is not arbitrary. It follows
 * the hierarchy every serious framework converges on — AARRR, Google's HEART,
 * GA4's engagement model:
 *
 *   סקירה    is this working at all
 *   המרה     does a visit become an account, and does the account reach value
 *   מעורבות  do they come back, and what did they do while here
 *   תוכן     which pages and cities earn the attention
 *   איכות    what is broken, slow, or confusing
 *
 * Retention and activation lead because they are the two things that cannot be
 * bought: traffic can always be increased, and a product that loses people
 * faster than it gains them simply loses them more expensively.
 *
 * WHAT THE UNITS MEAN, stated once because every panel inherits it:
 *   ביקור = one browser TAB. Two tabs are two visits; tomorrow is a new one.
 *   מבקר  = one browser, for up to 180 days (a random local id).
 * Neither is a person. Nothing here is called "משתמשים" unless it is joined to
 * an account.
 *
 * /deals, /admin, /login and /register emit no events at all — the privacy
 * notice promises it and lib/track.ts enforces it at the single exit point —
 * so they are absent from every table by construction, not by filtering.
 */

const RANGES = [7, 30, 90] as const;

const TABS = [
  { key: "overview", label: "סקירה", icon: "📊" },
  { key: "conversion", label: "המרה", icon: "🎯" },
  { key: "engagement", label: "מעורבות", icon: "🔁" },
  { key: "content", label: "תוכן", icon: "📄" },
  { key: "quality", label: "איכות", icon: "🛠️" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function AdminUsagePanel() {
  const [days, setDays] = useState<number>(30);
  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<UsagePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  // The chosen tab survives a reload; the range does not, on purpose — a stale
  // remembered window is how someone reads last quarter's numbers as today's.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("karnaf_usage_tab");
      if (saved && TABS.some((t) => t.key === saved)) setTab(saved as TabKey);
    } catch { /* storage blocked — the default is fine */ }
  }, []);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/admin/usage?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: UsagePayload) => { if (alive) { setData(j); setState("ready"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [days]);

  const selectTab = (k: TabKey) => {
    setTab(k);
    try { localStorage.setItem("karnaf_usage_tab", k); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3">
      {/* Sticky, because the range applies to everything below it and a reader
          deep in a table should not have to scroll back up to change it. */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 bg-white/95 px-1 py-2 backdrop-blur">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                tab === t.key
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span aria-hidden className="me-1">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-lg px-2.5 py-1 text-2xs font-bold transition-colors ${
                days === d ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {d} יום
            </button>
          ))}
        </div>
      </div>

      {state === "loading" && <p className="py-8 text-center text-sm text-slate-400">טוען נתוני שימוש…</p>}
      {state === "error" && (
        <p className="py-8 text-center text-sm text-rose-600">לא הצלחתי לטעון את נתוני השימוש. רענן את העמוד.</p>
      )}

      {state === "ready" && data && (
        <>
          <p className="text-2xs text-slate-400">
            {data.since && <>הלוג נאסף מאז <b dir="ltr">{data.since.slice(0, 10)}</b> · </>}
            {data.rollup.days > 0
              ? <>צבירה יומית: {data.rollup.days} ימים ({data.rollup.first} → {data.rollup.last})</>
              : <>הצבירה הלילית עוד לא רצה</>}
            {" · "}השוואה מול {days} הימים שקדמו לתקופה
          </p>

          {/* An insight names the tab that holds its full data, so the board
              can hand the reader straight there instead of asking them to find
              it — the difference between a recommendation and an errand. */}
          {tab === "overview" && <Overview data={data} onNavigate={(t) => selectTab(t as TabKey)} />}
          {tab === "conversion" && <Conversion data={data} />}
          {tab === "engagement" && <Engagement data={data} />}
          {tab === "content" && <Content data={data} />}
          {tab === "quality" && <Quality data={data} days={days} />}
        </>
      )}
    </div>
  );
}
