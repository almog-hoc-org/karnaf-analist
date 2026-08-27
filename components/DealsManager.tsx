"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { ClientDeal } from "@/lib/appDb";
import type { StreetComp } from "@/lib/compTypes";
import { addressGranularity, rowAddress } from "@/lib/compTypes";
import type { TrackedCitySummary } from "@/app/deals/page";
import TrendValue, { fmtSignedPct } from "@/components/TrendValue";
import { addTrackedCity, removeTrackedCity, addDeal, updateDeal, deleteDeal, addTask, toggleTask, deleteTask } from "@/app/deals/actions";
import InlineEdit from "@/components/InlineEdit";
import Icon from "@/components/Icon";

/** Personal deal tracker — the client-facing "apartment hunt" workspace. */

// Text only, no emoji (operator, 8/2026) — the icons rode inside the label
// strings, so removing them here cleans the filter and both selects at once.
const STATUSES = [
  { key: "seen", label: "ראיתי" },
  { key: "contacted", label: "יצרתי קשר" },
  { key: "negotiating", label: "במו״מ" },
  { key: "offer", label: "הגשתי הצעה" },
  { key: "closed", label: "נסגר" },
  { key: "dropped", label: "ירד מהפרק" },
] as const;

/**
 * One blue per city (operator, 8/2026): the group header and every row's side
 * bar carry it, so two cities' deals never read as one comparable list. The
 * hues are the site's petrol/sky family, ordered so neighbours differ; a
 * seventh city wraps around — by then the bars separate groups, not identify
 * them.
 */
const CITY_HUES = ["#0e7490", "#1d4ed8", "#0891b2", "#3730a3", "#0369a1", "#155e75"];
const cityHue = (i: number) => CITY_HUES[i % CITY_HUES.length];
type SortKey = "updated" | "city" | "price" | "sqm" | "delta";

/** Client-side label for what the comparison matched (mirrors lib/streetComps). */
const GEO_HE: Record<string, string> = { street: "רחוב", neighborhood: "שכונה", city: "יישוב" };
function compMatchNote(c: StreetComp): string {
  if (!c || c.n === 0) return "אין עסקאות דומות";
  const geo = GEO_HE[c.geoLevel] ?? "";
  if (c.matchLevel === "tight") return `התאמה מדויקת · ${geo}`;
  if (c.matchLevel === "wide") return `שטח מורחב · ${geo}`;
  if (c.matchLevel === "rooms") return `אותו מס׳ חדרים · ${geo}`;
  return `כל הדירות · ${geo}`;
}

export default function DealsManager({ allCities, tracked, deals, comps, modernMinYear = 2005 }: {
  allCities: string[];
  tracked: TrackedCitySummary[];
  deals: ClientDeal[];
  comps: Record<number, StreetComp>;
  /** the admin modern_min_year rule — the modern/old tag must match the rest of the site */
  modernMinYear?: number;
}) {
  const [, startTransition] = useTransition();
  const [cityQ, setCityQ] = useState("");
  const [showAdd, setShowAdd] = useState(deals.length === 0);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [fCity, setFCity] = useState<string>("");
  const [fStatus, setFStatus] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [form, setForm] = useState({ city: "", neighborhood: "", street: "", house_num: "", size: "", rooms: "", floor: "", price: "", balcony: "", parking: "", storage: "", listing_url: "", notes: "" });

  const citySuggestions = useMemo(
    () => cityQ.trim() ? allCities.filter((c) => c.includes(cityQ.trim())).slice(0, 6) : [],
    [cityQ, allCities]
  );

  const sqm = (d: ClientDeal) => (d.price && d.size && d.size > 0 ? d.price / d.size : null);
  const delta = (d: ClientDeal) => {
    const comp = comps[d.id];
    const s = sqm(d);
    return comp?.medianSqm && s ? (s / comp.medianSqm - 1) * 100 : null;
  };

  const visibleDeals = useMemo(() => {
    const out = deals.filter((d) => (!fCity || d.city === fCity) && (!fStatus || d.status === fStatus));
    const cmp: Record<SortKey, (a: ClientDeal, b: ClientDeal) => number> = {
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      city: (a, b) => a.city.localeCompare(b.city, "he"),
      price: (a, b) => (b.price ?? 0) - (a.price ?? 0),
      sqm: (a, b) => (sqm(b) ?? 0) - (sqm(a) ?? 0),
      delta: (a, b) => (delta(a) ?? 999) - (delta(b) ?? 999),
    };
    return [...out].sort(cmp[sort]);
  }, [deals, fCity, fStatus, sort, comps]);

  // Per-city GROUPS (operator spec 8/2026): deals from באר שבע and טירת כרמל
  // in one undivided list read as comparable rows when they are not — every
  // "פער מהשוק" is measured against its own city's median. With more than one
  // city visible, the table and the card list split under city headers.
  // Groups follow the current sort's first-appearance order, so "מיין לפי
  // מחיר" still ranks the groups by their top deal.
  const dealGroups = useMemo(() => {
    const cities = new Set(visibleDeals.map((d) => d.city));
    if (cities.size <= 1) return [{ city: null as string | null, deals: visibleDeals }];
    const order: string[] = [];
    const byCity = new Map<string, ClientDeal[]>();
    for (const d of visibleDeals) {
      if (!byCity.has(d.city)) { byCity.set(d.city, []); order.push(d.city); }
      byCity.get(d.city)!.push(d);
    }
    return order.map((city) => ({ city: city as string | null, deals: byCity.get(city)! }));
  }, [visibleDeals]);

  const submitAdd = () => {
    if (!form.city.trim()) return;
    startTransition(async () => {
      const res = await addDeal({
        city: form.city, neighborhood: form.neighborhood, street: form.street, house_num: form.house_num,
        size: form.size ? Number(form.size) : null, rooms: form.rooms ? Number(form.rooms) : null,
        floor: form.floor ? Number(form.floor) : null, price: form.price ? Number(form.price) : null,
        balcony_sqm: form.balcony ? Number(form.balcony) : null,
        parking_spots: form.parking ? Number(form.parking) : null,
        storage_sqm: form.storage ? Number(form.storage) : null,
        listing_url: form.listing_url, notes: form.notes,
      });
      // the action RETURNS failures (thrown messages are redacted in prod)
      if (res && !res.ok) alert(res.error);
    });
    setForm({ city: form.city, neighborhood: "", street: "", house_num: "", size: "", rooms: "", floor: "", price: "", balcony: "", parking: "", storage: "", listing_url: "", notes: "" });
  };

  const inputCls = "rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-indigo-400 focus:outline-none";

  // First-visit demo (operator request 8/2026): one click seeds a realistic
  // deal in the demo city so a new user sees the comparison engine working —
  // clearly labeled as a sample and deletable like any other deal.
  const loadSample = () => {
    startTransition(async () => {
      const res = await addDeal({
        city: "חיפה", neighborhood: "הדר", street: "הרצל", house_num: "20",
        size: 85, rooms: 3.5, floor: 2, price: 1_190_000,
        balcony_sqm: null, parking_spots: 1, storage_sqm: null,
        listing_url: "",
        notes: "עסקת דוגמה להתרשמות — מחק אותה בכל רגע עם כפתור הפח",
      });
      if (res && !res.ok) alert(res.error);
    });
  };

  return (
    <div className="space-y-8">
      {/* ── tracked cities ─────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-black text-slate-900">🏙️ הערים שבמעקב שלי</h2>
          <div className="relative">
            <input value={cityQ} onChange={(e) => setCityQ(e.target.value)} placeholder="+ הוסף עיר למעקב…"
              className="w-52 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs focus:border-indigo-400 focus:outline-none" />
            {citySuggestions.length > 0 && (
              <div className="absolute top-full right-0 z-[100] mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                {citySuggestions.map((c) => (
                  <button key={c} onClick={() => { startTransition(() => addTrackedCity(c)); setCityQ(""); }}
                    className="block w-full px-4 py-2 text-right text-xs font-semibold text-slate-700 hover:bg-indigo-50">
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {tracked.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
            הוסף את העיר שבה אתה מחפש — ותקבל כאן סיכום נתונים חי עליה
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tracked.map((t) => (
              <div key={t.city} className="glass-card relative p-5">
                <button onClick={() => startTransition(() => removeTrackedCity(t.city))}
                  className="absolute left-3 top-3 text-slate-300 hover:text-red-500" title="הסר מהמעקב"><Icon name="close" size="1em" /></button>
                <Link href={`/city/${encodeURIComponent(t.city)}`} className="text-lg font-black text-slate-900 hover:text-indigo-700">
                  {t.city} ←
                </Link>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="stat-label">חציון יד-2 ₪/מ״ר</div>
                    <div className="text-xl font-black tabular-nums text-indigo-700">
                      {t.medianShSqm ? `₪${t.medianShSqm.toLocaleString("he-IL")}` : "—"}
                    </div>
                    <div className="text-2xs text-slate-400">{t.priceYear ?? ""}</div>
                  </div>
                  <div>
                    <div className="stat-label">שינוי יד-2 3 שנים</div>
                    <div className="text-xl"><TrendValue pct={t.chg3y} className="!text-xl font-black" /></div>
                    <div className="text-2xs text-slate-400">{t.chg3yWindow ?? ""}</div>
                  </div>
                  <div>
                    <div className="stat-label">עסקאות 12 ח׳</div>
                    <div className="text-base font-bold tabular-nums text-slate-900">{t.deals12m.toLocaleString("he-IL")}</div>
                  </div>
                  <div>
                    <div className="stat-label">שכונות פעילות</div>
                    <div className="text-base font-bold tabular-nums text-slate-900">{t.activeNeighborhoods}</div>
                  </div>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-2 text-2xs text-slate-400">
                  🔵 {t.totalDeals.toLocaleString("he-IL")} עסקאות במאגר העצמאי
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── deals table ────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-lg font-black text-slate-900">📋 העסקאות שלי ({deals.length})</h2>
          <select value={fCity} onChange={(e) => setFCity(e.target.value)} className={inputCls}>
            <option value="">כל הערים</option>
            {[...new Set(deals.map((d) => d.city))].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
            <option value="">כל הסטטוסים</option>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={inputCls}>
            <option value="updated">עדכון אחרון</option>
            <option value="city">עיר</option>
            <option value="price">מחיר</option>
            <option value="sqm">₪/מ״ר</option>
            <option value="delta">פער מהשוק</option>
          </select>
          <button onClick={() => setShowAdd((v) => !v)}
            className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700">
            {showAdd ? "סגור" : "+ עסקה חדשה"}
          </button>
        </div>

        {/* add form */}
        {showAdd && (
          <div className="glass-card mb-4 p-4">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <input list="deal-cities" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="עיר *" className={inputCls} />
              <datalist id="deal-cities">{allCities.map((c) => <option key={c} value={c} />)}</datalist>
              <input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} placeholder="שכונה" className={inputCls} />
              <input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} placeholder="רחוב" className={inputCls} />
              <input value={form.house_num} onChange={(e) => setForm({ ...form, house_num: e.target.value })} placeholder="מס׳ בית" className={inputCls} />
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="מחיר מבוקש ₪" inputMode="numeric" className={inputCls} />
              <input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="גודל מ״ר" inputMode="decimal" className={inputCls} />
              <input value={form.rooms} onChange={(e) => setForm({ ...form, rooms: e.target.value })} placeholder="חדרים" inputMode="decimal" className={inputCls} />
              <input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} placeholder="קומה" inputMode="numeric" className={inputCls} />
              <input value={form.balcony} onChange={(e) => setForm({ ...form, balcony: e.target.value })} placeholder="🌤️ מרפסת מ״ר" inputMode="decimal" className={inputCls} />
              <input value={form.parking} onChange={(e) => setForm({ ...form, parking: e.target.value })} placeholder="🚗 חניות" inputMode="numeric" className={inputCls} />
              <input value={form.storage} onChange={(e) => setForm({ ...form, storage: e.target.value })} placeholder="📦 מחסן מ״ר" inputMode="decimal" className={inputCls} />
              <input value={form.listing_url} onChange={(e) => setForm({ ...form, listing_url: e.target.value })} placeholder="🔗 קישור למודעה" dir="ltr" className={`${inputCls} md:col-span-2`} />
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="הערות…" className={`${inputCls} col-span-2 md:col-span-4`} />
              <button onClick={submitAdd} disabled={!form.city.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-40 hover:bg-indigo-700">
                שמור עסקה
              </button>
            </div>
            <p className="mt-2 text-2xs text-slate-400">ציון רחוב מדליק השוואה אוטומטית לעסקאות אמת באותו רחוב</p>
          </div>
        )}

        {/* ── mobile: card per deal — a 12-column table on a phone is an
            endless horizontal scroll, so below md each deal is a card with
            the detail expanding inline. The table below is md+ only. ── */}
        <div className="space-y-3 md:hidden">
          {visibleDeals.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              <p>אין עסקאות עדיין — הוסף את הראשונה למעלה</p>
              {deals.length === 0 && (
                <button onClick={loadSample} className="mt-3 rounded-full border border-indigo-200 bg-white px-4 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50">
                  או טען עסקת דוגמה ←
                </button>
              )}
            </div>
          )}
          {dealGroups.map((g, gi) => (
            <div key={g.city ?? "__all__"} className="space-y-3">
              {g.city && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="h-3.5 w-1.5 rounded-full" style={{ backgroundColor: cityHue(gi) }} />
                  <span className="text-sm font-black" style={{ color: cityHue(gi) }}>{g.city}</span>
                  <span className="text-2xs text-slate-400">({g.deals.length}) · הפער נמדד מול השוק של {g.city}</span>
                </div>
              )}
              {g.deals.map((d) => {
            const comp = comps[d.id];
            const s = sqm(d);
            const dl = delta(d);
            const open = openRow === d.id;
            const openTasks = d.tasks.filter((t) => !t.done).length;
            return (
              /* the whole card toggles the detail — every interactive child
                 inside stops propagation (operator, 8/2026) */
              <div
                key={d.id}
                onClick={() => setOpenRow(open ? null : d.id)}
                className={`glass-card cursor-pointer p-4 ${open ? "ring-1 ring-indigo-200" : ""}`}
                style={g.city ? { borderInlineStart: `3px solid ${cityHue(gi)}` } : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-black text-slate-900">{d.city}</div>
                    <div className="text-2xs text-slate-500">
                      {[d.street && `${d.street} ${d.house_num ?? ""}`.trim(), d.neighborhood].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); if (confirm(`למחוק את העסקה ב${d.city}?`)) startTransition(() => deleteDeal(d.id)); }}
                    className="flex-shrink-0 text-slate-300 hover:text-red-500"><Icon name="trash" size="1em" /></button>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5 text-2xs text-slate-600">
                  {d.size ? <span className="rounded-full bg-slate-100 px-2 py-0.5 tabular-nums">{d.size} מ״ר</span> : null}
                  {d.rooms ? <span className="rounded-full bg-slate-100 px-2 py-0.5 tabular-nums">{d.rooms} חד׳</span> : null}
                  {d.floor != null ? <span className="rounded-full bg-slate-100 px-2 py-0.5 tabular-nums">קומה {d.floor}</span> : null}
                  {d.balcony_sqm ? <span className="rounded-full bg-slate-100 px-2 py-0.5 tabular-nums">🌤️ {d.balcony_sqm}</span> : null}
                  {d.parking_spots ? <span className="rounded-full bg-slate-100 px-2 py-0.5 tabular-nums">🚗 {d.parking_spots}</span> : null}
                  {d.storage_sqm ? <span className="rounded-full bg-slate-100 px-2 py-0.5 tabular-nums">📦 {d.storage_sqm}</span> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-lg font-black tabular-nums text-slate-900">
                    {d.price ? `₪${d.price.toLocaleString("he-IL")}` : "—"}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-indigo-700">
                    {s ? `₪${Math.round(s).toLocaleString("he-IL")}/מ״ר` : ""}
                  </span>
                </div>

                {comp?.medianSqm ? (
                  <button onClick={(e) => { e.stopPropagation(); setOpenRow(open ? null : d.id); }} className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                    <span dir="ltr" className={`font-black tabular-nums ${dl == null ? "text-slate-400" : dl > 3 ? "text-red-600" : dl < -3 ? "text-emerald-700" : "text-slate-700"}`}>
                      {dl != null ? fmtSignedPct(dl) : "—"}
                    </span>
                    <span className="mr-2 text-2xs text-slate-500">
                      מול ₪{comp.medianSqm.toLocaleString("he-IL")} · {compMatchNote(comp)} ({comp.n}) {open ? "▴" : "▾"}
                    </span>
                  </button>
                ) : (
                  <p className="mt-2 text-2xs text-slate-400">אין דאטה להשוואת שוק</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select value={d.status} onClick={(e) => e.stopPropagation()} onChange={(e) => startTransition(() => updateDeal(d.id, { status: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-2xs font-bold">
                    {STATUSES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
                  </select>
                  <button onClick={(e) => { e.stopPropagation(); setOpenRow(open ? null : d.id); }}
                    className={`rounded-full px-2.5 py-1 text-2xs font-bold ${openTasks > 0 ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
                    {openTasks > 0 ? `${openTasks} משימות פתוחות` : "משימות"} {open ? "▴" : "▾"}
                  </button>
                  {d.listing_url && (
                    <a href={d.listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="mr-auto text-indigo-600 hover:text-indigo-800"><Icon name="link" size="1em" /></a>
                  )}
                </div>

                {open && (
                  /* clicks inside the detail (notes, tasks, inputs) must not
                     bubble to the card's own toggle and slam it shut */
                  <div className="mt-3 border-t border-slate-100 pt-3" onClick={(e) => e.stopPropagation()}>
                    <DealDetail deal={d} comp={comp} askSqm={s} modernMinYear={modernMinYear} />
                  </div>
                )}
              </div>
            );
              })}
            </div>
          ))}
        </div>

        {/* table — md+ only */}
        <div className="glass-card hidden overflow-x-auto md:block">
          <table className="table-pin-first w-full min-w-[900px] text-xs" dir="rtl">
            <thead className="bg-slate-50 text-2xs font-bold text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2.5 text-right">📍 כתובת</th>
                <th className="px-3 py-2.5">גודל</th>
                <th className="px-3 py-2.5">חד׳</th>
                <th className="px-3 py-2.5">קומה</th>
                <th className="px-3 py-2.5">נלווים</th>
                <th className="px-3 py-2.5">מחיר מבוקש</th>
                <th className="px-3 py-2.5">₪/מ״ר</th>
                <th className="px-3 py-2.5">השוואת שוק 🔵</th>
                <th className="px-3 py-2.5">סטטוס</th>
                <th className="px-3 py-2.5"><Icon name="link" size="1em" /></th>
                <th className="px-3 py-2.5">משימות</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {visibleDeals.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-400">
                  אין עסקאות עדיין — הוסף את הראשונה למעלה
                  {deals.length === 0 && (
                    <button onClick={loadSample} className="mr-3 rounded-full border border-indigo-200 bg-white px-4 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50">
                      או טען עסקת דוגמה ←
                    </button>
                  )}
                </td></tr>
              )}
              {dealGroups.map((g, gi) => (
                <FragmentRow key={g.city ?? "__all__"}>
                  {g.city && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={12} className="px-3 py-1.5 text-right" style={{ borderInlineStart: `3px solid ${cityHue(gi)}` }}>
                        <span className="text-xs font-black" style={{ color: cityHue(gi) }}>{g.city}</span>
                        <span className="mr-2 text-2xs text-slate-400">({g.deals.length}) · הפער נמדד מול השוק של {g.city}</span>
                      </td>
                    </tr>
                  )}
                  {g.deals.map((d) => {
                const comp = comps[d.id];
                const s = sqm(d);
                const dl = delta(d);
                const open = openRow === d.id;
                const openTasks = d.tasks.filter((t) => !t.done).length;
                return (
                  <FragmentRow key={d.id}>
                    {/* the whole row toggles the detail (operator, 8/2026) —
                        rows with no comparison data had no way in at all.
                        Every interactive cell stops propagation. */}
                    <tr
                      onClick={() => setOpenRow(open ? null : d.id)}
                      className={`cursor-pointer border-b border-slate-100 transition-colors hover:bg-indigo-50/40 ${open ? "bg-indigo-50/60" : ""}`}
                    >
                      <td className="px-3 py-2.5" style={g.city ? { borderInlineStart: `3px solid ${cityHue(gi)}` } : undefined}>
                        <div className="font-bold text-slate-900">{d.city}</div>
                        <div className="text-2xs text-slate-500">
                          {[d.street && `${d.street} ${d.house_num ?? ""}`.trim(), d.neighborhood].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums">
                        <InlineEdit value={d.size} fmt={(v) => `${v} מ״ר`} suffix="מ״ר"
                          onSave={(v) => startTransition(() => updateDeal(d.id, { size: v }))} />
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums">
                        <InlineEdit value={d.rooms} fmt={(v) => String(v)} suffix="חד׳"
                          onSave={(v) => startTransition(() => updateDeal(d.id, { rooms: v }))} />
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums">
                        <InlineEdit value={d.floor} fmt={(v) => String(v)} suffix="קומה"
                          onSave={(v) => startTransition(() => updateDeal(d.id, { floor: v }))} />
                      </td>
                      <td className="px-3 py-2.5 text-center text-2xs tabular-nums text-slate-600" title="מרפסת · חניות · מחסן">
                        {[
                          d.balcony_sqm ? `🌤️${d.balcony_sqm}` : null,
                          d.parking_spots ? `🚗${d.parking_spots}` : null,
                          d.storage_sqm ? `📦${d.storage_sqm}` : null,
                        ].filter(Boolean).join(" ") || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold tabular-nums text-slate-900">
                        <InlineEdit value={d.price} fmt={(v) => `₪${v.toLocaleString("he-IL")}`} suffix="₪"
                          onSave={(v) => startTransition(() => updateDeal(d.id, { price: v }))} />
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold tabular-nums text-indigo-700">
                        {s ? `₪${Math.round(s).toLocaleString("he-IL")}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {comp?.medianSqm ? (
                          <button onClick={(e) => { e.stopPropagation(); setOpenRow(open ? null : d.id); }} className="group text-right" title="לחץ להשוואה מפורטת">
                            <span dir="ltr" className={`font-black tabular-nums ${dl == null ? "text-slate-400" : dl > 3 ? "text-red-600" : dl < -3 ? "text-emerald-700" : "text-slate-700"}`}>
                              {dl != null ? fmtSignedPct(dl) : "—"}
                            </span>
                            <span className="block text-2xs text-slate-400 group-hover:text-indigo-600">
                              מול ₪{comp.medianSqm.toLocaleString("he-IL")} · {compMatchNote(comp)} ({comp.n}) ▾
                            </span>
                          </button>
                        ) : <span className="text-slate-300">אין דאטה</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <select value={d.status} onClick={(e) => e.stopPropagation()} onChange={(e) => startTransition(() => updateDeal(d.id, { status: e.target.value }))}
                          className="rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-2xs font-bold">
                          {STATUSES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {d.listing_url ? (
                          <a href={d.listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-indigo-600 hover:text-indigo-800" title={d.listing_url}><Icon name="link" size="1em" /></a>
                        ) : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={(e) => { e.stopPropagation(); setOpenRow(open ? null : d.id); }}
                          className={`rounded-full px-2 py-0.5 text-2xs font-bold ${openTasks > 0 ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
                          {openTasks > 0 ? `${openTasks} פתוחות` : "משימות"} ▾
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={(e) => { e.stopPropagation(); if (confirm(`למחוק את העסקה ב${d.city}?`)) startTransition(() => deleteDeal(d.id)); }}
                          className="text-slate-300 hover:text-red-500"><Icon name="trash" size="1em" /></button>
                      </td>
                    </tr>
                    {open && (
                      // desktop only: inside the 900px-wide table this row is
                      // readable; on mobile it would force horizontal scrolling,
                      // so the detail renders BELOW the table instead (see after
                      // the wrapper) — same content, reachable layout.
                      <tr className="max-md:hidden border-b border-slate-100 bg-slate-50/70">
                        <td colSpan={12} className="px-4 py-4">
                          <DealDetail deal={d} comp={comp} askSqm={s} modernMinYear={modernMinYear} />
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
                  })}
                </FragmentRow>
              ))}
            </tbody>
          </table>
        </div>
        {/* mobile detail now renders INLINE inside the open card above —
            no separate block needed */}
        <p className="mt-2 text-2xs text-slate-400">
          🔵 ההשוואה מחפשת עסקאות אמת מאותו מספר חדרים ובשטח דומה — קודם ברחוב, ואם אין גם בשכונה וביישוב · אדום = מעל מחיר השוק, ירוק = מתחת · ₪/מ״ר מחושב על שטח הדירה בלבד (מרפסת/מחסן מוצגים בנפרד)
        </p>
      </section>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function DealDetail({ deal, comp, askSqm, modernMinYear }: { deal: ClientDeal; comp?: StreetComp; askSqm: number | null; modernMinYear: number }) {
  const [, startTransition] = useTransition();
  const [taskTitle, setTaskTitle] = useState("");
  const [notes, setNotes] = useState(deal.notes ?? "");

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* recent street/neighborhood deals */}
      <div>
        <h4 className="mb-2 text-xs font-black text-slate-900">
          עסקאות אחרונות — {comp?.label ?? "אין דאטה"} {comp && <span className="font-normal text-slate-400">({comp.n} עסקאות)</span>}
        </h4>
        {comp && comp.recent.length > 0 ? (() => {
          // Show the address column only when the source actually carries location.
          // Big cities → street; some towns → neighborhood; small settlements
          // (e.g. רמת ישי) expose neither, so we drop the column and say so
          // honestly rather than printing a row of meaningless dashes.
          const grain = addressGranularity(comp.recent);
          const addrHead = grain === "street" ? "כתובת" : grain === "neighborhood" ? "שכונה" : null;
          return (
            <>
              <div className="overflow-x-auto">
              <table className="table-pin-first w-full min-w-[560px] text-2xs" dir="rtl">
                <thead className="text-2xs font-bold text-slate-400">
                  <tr>
                    <th className="py-1 text-right">תאריך</th>
                    {addrHead && <th>{addrHead}</th>}
                    <th>גודל</th><th>חד׳</th><th>שנת בנייה</th><th>מחיר</th><th>₪/מ״ר</th>
                  </tr>
                </thead>
                <tbody>
                  {comp.recent.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{r.deal_date?.slice(0, 10)}</td>
                      {addrHead && <td className="text-center text-slate-600">{rowAddress(r) ?? "—"}</td>}
                      <td className="text-center tabular-nums">{r.area ? `${r.area}` : "—"}</td>
                      <td className="text-center tabular-nums">{r.rooms ?? "—"}</td>
                      <td className="text-center tabular-nums">
                        {r.year_built ? (
                          <span className="inline-flex items-center gap-1">
                            {r.year_built}
                            <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${
                              r.year_built >= modernMinYear ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                            }`}>
                              {r.year_built >= modernMinYear ? "מודרני" : "ישן"}
                            </span>
                          </span>
                        ) : "—"}
                      </td>
                      <td className="text-center font-bold tabular-nums">₪{Number(r.price ?? 0).toLocaleString("he-IL")}</td>
                      <td className={`text-center font-bold tabular-nums ${askSqm && r.price_sqm && askSqm > Number(r.price_sqm) ? "text-emerald-700" : "text-slate-700"}`}>
                        ₪{Number(r.price_sqm ?? 0).toLocaleString("he-IL")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {grain === "none" && (
                <p className="mt-1.5 text-2xs text-slate-400">כתובת מדויקת אינה מפורסמת במקור עבור יישוב זה — ההשוואה ברמת היישוב.</p>
              )}
            </>
          );
        })() : (
          <p className="text-2xs text-slate-400">לא נמצאו עסקאות דומות בטווח — ההשוואה היא לחציון העירוני</p>
        )}
      </div>

      {/* tasks + notes */}
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 text-xs font-black text-slate-900">✅ משימות</h4>
          <ul className="space-y-1">
            {deal.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-2xs">
                <input type="checkbox" checked={!!t.done} onChange={(e) => startTransition(() => toggleTask(t.id, e.target.checked))} className="accent-indigo-600" />
                <span className={t.done ? "text-slate-400 line-through" : "text-slate-700"}>{t.title}</span>
                <button onClick={() => startTransition(() => deleteTask(t.id))} className="mr-auto text-slate-300 hover:text-red-500"><Icon name="close" size="1em" /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-1.5">
            <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && taskTitle.trim()) { startTransition(() => addTask(deal.id, taskTitle)); setTaskTitle(""); } }}
              placeholder="משימה חדשה… (Enter לשמירה)" className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-2xs focus:border-indigo-400 focus:outline-none" />
          </div>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-black text-slate-900">📝 הערות</h4>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (deal.notes ?? "")) startTransition(() => updateDeal(deal.id, { notes })); }}
            rows={3} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-2xs focus:border-indigo-400 focus:outline-none"
            placeholder="הערות על הנכס, המוכר, המתווך…" />
        </div>
      </div>
    </div>
  );
}
