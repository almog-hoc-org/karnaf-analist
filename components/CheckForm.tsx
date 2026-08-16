"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

/**
 * The /check query, as a GET form.
 *
 * GET and not a server action, deliberately: the answer has to be a URL. A
 * verdict nobody can send to the person selling them the apartment is worth
 * very little, and every share carries the query that produced it.
 */
export default function CheckForm({
  cities,
  initial,
}: {
  cities: string[];
  initial: { city: string; street: string; neighborhood: string; rooms: string; size: string; price: string };
}) {
  const [city, setCity] = useState(initial.city);

  const field = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";
  const label = "mb-1 block text-2xs font-bold text-slate-500";

  return (
    <form method="GET" action="/check" className="glass-card p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={label} htmlFor="check-city">יישוב <span className="text-rose-500">*</span></label>
          <input
            id="check-city" name="city" list="check-cities" required className={field}
            value={city} onChange={(e) => setCity(e.target.value)}
            placeholder="למשל: חיפה" autoComplete="off"
          />
          <datalist id="check-cities">
            {cities.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className={label} htmlFor="check-street">רחוב</label>
          <input id="check-street" name="street" defaultValue={initial.street} className={field} placeholder="למשל: הרצל" autoComplete="off" />
        </div>
        <div>
          <label className={label} htmlFor="check-neighborhood">שכונה</label>
          <input id="check-neighborhood" name="neighborhood" defaultValue={initial.neighborhood} className={field} placeholder="אם ידועה" autoComplete="off" />
        </div>
        <div>
          <label className={label} htmlFor="check-rooms">חדרים</label>
          <input id="check-rooms" name="rooms" defaultValue={initial.rooms} className={field} inputMode="decimal" placeholder="4" />
        </div>
        <div>
          <label className={label} htmlFor="check-size">גודל במ״ר</label>
          <input id="check-size" name="size" defaultValue={initial.size} className={field} inputMode="numeric" placeholder="100" />
        </div>
        <div>
          <label className={label} htmlFor="check-price">המחיר שמבקשים (₪)</label>
          <input id="check-price" name="price" defaultValue={initial.price} className={field} inputMode="numeric" placeholder="2,100,000" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700">
          <Icon name="search" size="1em" /> בדיקת המחיר
        </button>
        <span className="text-2xs text-slate-400">
          רחוב וגודל מדייקים את ההשוואה. בלעדיהם נקבל את רמת המחירים ביישוב.
        </span>
      </div>
    </form>
  );
}
