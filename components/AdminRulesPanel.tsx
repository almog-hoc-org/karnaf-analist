"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/basePath";

/** Every parameter the site's numbers rely on — editable, switchable, resettable. */
interface Rule {
  key: string; label: string; group: string; kind: "number" | "boolean" | "text";
  default: number | boolean | string; unit?: string; help: string; toggleOnly?: boolean;
  value: number | boolean | string; enabled: boolean; overridden: boolean;
}

export default function AdminRulesPanel() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch(withBasePath("/api/admin/rules"));
    const d = await res.json();
    setRules(d.rules ?? []);
  };
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const g = new Map<string, Rule[]>();
    for (const r of rules) { if (!g.has(r.group)) g.set(r.group, []); g.get(r.group)!.push(r); }
    return [...g.entries()];
  }, [rules]);

  const save = async (key: string, value: string, enabled: boolean) => {
    setBusy(true);
    const res = await fetch(withBasePath("/api/admin/rules"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, enabled }),
    });
    const d = await res.json();
    if (d.rules) setRules(d.rules);
    setDirty(true); setBusy(false);
  };

  const reset = async (key: string) => {
    setBusy(true);
    const res = await fetch(withBasePath("/api/admin/rules"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", key }),
    });
    const d = await res.json();
    if (d.rules) setRules(d.rules);
    setDraft((s) => { const n = { ...s }; delete n[key]; return n; });
    setDirty(true); setBusy(false);
  };

  const applyToSite = async () => {
    setApplyMsg("מריץ חישוב מחדש…");
    const res = await fetch(withBasePath("/api/admin/reaggregate"), { method: "POST" });
    const d = await res.json();
    setApplyMsg(d.ok ? `✓ הוחל על האתר (${d.statRows?.toLocaleString("he-IL")} שורות חושבו מחדש)` : `✗ ${d.error}`);
    if (d.ok) setDirty(false);
  };

  return (
    <section className="glass-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-lg font-black text-slate-900">⚙️ חוקי המערכת</h2>
        {dirty && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-2xs font-bold text-amber-700">
            יש שינויים שממתינים להחלה
          </span>
        )}
        <button onClick={applyToSite} disabled={busy}
          className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
          ⚡ החל שינויים על האתר
        </button>
        {applyMsg && <span className="text-2xs text-slate-500">{applyMsg}</span>}
      </div>
      <p className="mb-4 text-2xs leading-relaxed text-slate-500">
        כל פרמטר שהאתר מתבסס עליו. שינוי משפיע מיד על חישובים חיים (השוואות, סינון תצוגה) —
        ועל הגרפים והדירוגים אחרי לחיצה על "החל שינויים".
      </p>

      <div className="space-y-5">
        {groups.map(([group, items]) => (
          <div key={group}>
            <h3 className="mb-2 border-b border-slate-100 pb-1 text-xs font-black text-indigo-700">{group}</h3>
            <div className="space-y-2">
              {items.map((r) => {
                const cur = draft[r.key] ?? String(r.value);
                return (
                  <div key={r.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <div className="min-w-[220px] flex-1">
                      <div className="text-xs font-bold text-slate-800">
                        {r.label}
                        {r.overridden && <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-2xs font-bold text-indigo-700">שונה</span>}
                      </div>
                      <div className="text-2xs leading-snug text-slate-500">{r.help}</div>
                    </div>

                    {r.kind === "boolean" || r.toggleOnly ? (
                      <label className="flex cursor-pointer items-center gap-1.5 text-2xs font-bold">
                        <input type="checkbox" checked={r.enabled} className="accent-indigo-600"
                          onChange={(e) => save(r.key, String(r.value), e.target.checked)} />
                        {r.enabled ? "פעיל" : "כבוי"}
                      </label>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={cur}
                          onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}
                          onBlur={() => { if (cur !== String(r.value)) save(r.key, cur, true); }}
                          inputMode={r.kind === "number" ? "decimal" : "text"}
                          className={`rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold tabular-nums focus:border-indigo-400 focus:outline-none ${r.kind === "text" ? "w-56" : "w-24"}`}
                        />
                        {r.unit && <span className="text-2xs text-slate-400">{r.unit}</span>}
                      </div>
                    )}

                    <button onClick={() => reset(r.key)} title={`ברירת מחדל: ${r.default}`}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-2xs font-bold text-slate-400 hover:text-slate-700">
                      איפוס
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
