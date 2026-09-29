"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { buttonClass } from "@/components/ui/Button";

/**
 * The /check query, as a GET form.
 *
 * GET and not a server action, deliberately: the answer has to be a URL. A
 * verdict nobody can send to the person selling them the apartment is worth
 * very little, and every share carries the query that produced it.
 *
 * Two shapes, one form:
 *  - `compact` (the home hero): the address and one big button. Nothing else to
 *    decide before the first answer; the result page asks for size and price.
 *  - full (/check): the address, then size, price, rooms and neighbourhood,
 *    all visible (a 9/2026 version folded the last two away; readers took
 *    hidden fields for missing ones).
 */
export default function CheckForm({
  cities,
  initial,
  compact = false,
}: {
  cities: string[];
  initial: { city: string; street: string; house: string; neighborhood: string; rooms: string; size: string; price: string };
  compact?: boolean;
}) {
  const [city, setCity] = useState(initial.city);

  const field = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";
  const label = "mb-1 block text-2xs font-bold text-slate-500";
  const listId = compact ? "home-check-cities" : "check-cities";
  const id = (k: string) => `${compact ? "home-" : ""}check-${k}`;

  const address = (
    <div className={compact ? "grid gap-3 sm:grid-cols-[1.1fr_1.4fr_5.5rem]" : "grid gap-4 sm:grid-cols-[1.1fr_1.4fr_5.5rem]"}>
      <div>
        <label className={label} htmlFor={id("city")}>יישוב <span className="text-rose-500">*</span></label>
        <input
          id={id("city")} name="city" list={listId} required className={field}
          value={city} onChange={(e) => setCity(e.target.value)}
          placeholder="למשל: חיפה" autoComplete="off"
        />
        <datalist id={listId}>
          {cities.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div>
        <label className={label} htmlFor={id("street")}>רחוב</label>
        <input id={id("street")} name="street" defaultValue={initial.street} className={field} placeholder="למשל: הרצל" autoComplete="off" />
      </div>
      <div>
        {/* With a number the ladder gains a rung: the deals within a few
            hundred metres of THIS building, before the whole neighbourhood. */}
        <label className={label} htmlFor={id("house")}>מס׳ בית</label>
        <input id={id("house")} name="house" defaultValue={initial.house} className={field} inputMode="numeric" placeholder="12" autoComplete="off" />
      </div>
    </div>
  );

  if (compact) {
    return (
      <form method="GET" action="/check" className="glass-card p-4 text-right sm:p-5">
        <div className="mb-3 text-base font-extrabold text-slate-900">כמה שווה דירה בכתובת הזו?</div>
        {address}
        <button type="submit" className={buttonClass("primary", "lg", "mt-4 w-full")}>
          <Icon name="search" size="1em" /> בדיקת מחיר
        </button>
        <p className="mt-2 text-center text-2xs text-slate-400">השוואה לעסקאות אמת באותו רחוב · בלי הרשמה</p>
      </form>
    );
  }

  return (
    <form method="GET" action="/check" className="glass-card p-5 sm:p-6">
      {address}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div>
          <label className={label} htmlFor="check-size">גודל במ״ר</label>
          <input id="check-size" name="size" defaultValue={initial.size} className={field} inputMode="numeric" placeholder="100" />
        </div>
        <div>
          <label className={label} htmlFor="check-price">המחיר שמבקשים (₪)</label>
          <input id="check-price" name="price" defaultValue={initial.price} className={field} inputMode="numeric" placeholder="2,100,000" />
        </div>
        <div>
          <label className={label} htmlFor="check-rooms">חדרים</label>
          <input id="check-rooms" name="rooms" defaultValue={initial.rooms} className={field} inputMode="decimal" placeholder="4" />
        </div>
        <div>
          <label className={label} htmlFor="check-neighborhood">שכונה</label>
          <input id="check-neighborhood" name="neighborhood" defaultValue={initial.neighborhood} className={field} placeholder="אם ידועה" autoComplete="off" />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass("primary", "lg")}>
          <Icon name="search" size="1em" /> בדיקת המחיר
        </button>
        <span className="text-2xs text-slate-400">
          גודל ומחיר נותנים פסק דין; בלעדיהם תקבלו את רמת המחירים באזור.
        </span>
      </div>
    </form>
  );
}
