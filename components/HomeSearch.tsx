"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { track, trackSearch, trackSearchSelect } from "@/lib/track";
import { citySearch, type CitySearchHit } from "@/lib/citySearch";

interface CityItem {
  id: number;
  city_name: string;
  price_change_pct: number | null;
  population_2024: number | null;
  population_2022: number | null;
  population_2026: number | null;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("he-IL");
}

export default function HomeSearch({ cities }: { cities: CityItem[] }) {
  const [value, setValue] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<CitySearchHit<CityItem>>>([]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(newValue.trim()), 200);
  };

  const handleClear = () => {
    setValue("");
    setQuery("");
    setHits([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const results = hits.slice(0, 20);

  // Fires on the debounced query, so it records what the user settled on rather
  // than every keystroke on the way there. Routed through the same helper as the
  // TopNav box so the two can never drift on what counts as "no results".
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const next = citySearch(cities, query, 20);
    setHits(next);
    trackSearch(query, next.length, "home");
  }, [query, cities]);

  return (
    <div className="relative w-full">
      <div className="pointer-events-none absolute inset-y-0 end-4 flex items-center">
        <svg
          className="h-5 w-5 text-slate-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
      </div>

      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="חיפוש עיר..."
        dir="rtl"
        className="
          w-full
          rounded-2xl
          bg-white
          border border-slate-200
          py-4
          ps-12 pe-12
          text-base text-slate-900
          placeholder:text-slate-400
          focus:outline-none
          focus:ring-2
          focus:ring-indigo-500/20
          focus:border-indigo-500
          transition-all
          duration-200
          shadow-sm
        "
        autoComplete="off"
        spellCheck={false}
      />

      {value && (
        <button
          onClick={handleClear}
          className="absolute inset-y-0 start-4 flex items-center text-slate-400 hover:text-slate-700 transition-colors"
          aria-label="נקה חיפוש"
        >
          <svg
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Search results dropdown */}
      {query && (
        <div className="absolute z-[100] mt-2 w-full rounded-xl bg-white border border-slate-200 shadow-xl max-h-[400px] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-5 py-4 text-center">
              <p className="text-sm font-bold text-slate-700">לא מצאנו עיר בשם הזה</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                נסו כתיב קרוב, למשל קרית/קריית, או הקלידו חלק מהשם.
              </p>
            </div>
          ) : (
            <div className="py-1">
              <p className="text-xs text-slate-500 px-5 py-2 border-b border-slate-100">
                {results.length} תוצאות עבור &ldquo;{query}&rdquo;
              </p>
              {results.map(({ item: city, reason }) => (
                <Link
                  key={city.id}
                  href={`/city/${encodeURIComponent(city.city_name)}`}
                  onClick={() => {
                    if (reason === "typo" || reason === "alias") {
                      track("no_result_suggestion_click", { subject: query, detail: city.city_name });
                    }
                    // Searches were counted; searches that ENDED SOMEWHERE were
                    // not. Without this, a box that returns plausible-looking
                    // rows nobody clicks is indistinguishable from one that works.
                    trackSearchSelect(city.city_name, query);
                  }}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-indigo-50 transition-colors group"
                >
                  <span className="min-w-0 flex-1 basis-28 break-words font-semibold leading-tight text-slate-900 group-hover:text-indigo-700 transition-colors">
                    {city.city_name}
                  </span>
                  <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-sm text-slate-600">
                    {/* second-hand 3y change from real transactions (labeled) */}
                    {city.price_change_pct !== null && (
                      <span className="whitespace-nowrap">
                        יד-2 3 שנים:{" "}
                        <span className={(city.price_change_pct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}>
                          {formatPct(city.price_change_pct)}
                        </span>
                      </span>
                    )}
                    <span className="whitespace-nowrap">
                      אוכלוסייה:{" "}
                      <span className="text-slate-800">
                        {formatNumber(city.population_2024 ?? city.population_2022 ?? city.population_2026)}
                      </span>
                    </span>
                    {reason === "typo" || reason === "alias" ? (
                      <span className="whitespace-nowrap text-indigo-600">הצעה קרובה</span>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
