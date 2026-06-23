"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface SearchBarProps {
  initialQuery: string;
}

export default function SearchBar({ initialQuery }: SearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local state in sync if the URL param changes externally
  useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  const updateUrl = useCallback(
    (query: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) {
        params.set("q", query);
      } else {
        params.delete("q");
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      updateUrl(newValue.trim());
    }, 300);
  };

  const handleClear = () => {
    setValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    updateUrl("");
  };

  return (
    <div className="relative w-full">
      {/* Search icon */}
      <div className="pointer-events-none absolute inset-y-0 end-4 flex items-center">
        <svg
          className="h-5 w-5 text-zinc-500"
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
          rounded-xl
          bg-zinc-900
          border border-zinc-700
          px-4 py-3.5
          pe-12
          text-base text-zinc-100
          placeholder:text-zinc-500
          focus:outline-none
          focus:ring-2
          focus:ring-cyan-500/50
          focus:border-cyan-600
          transition-all
          duration-200
        "
        autoComplete="off"
        spellCheck={false}
      />

      {/* Clear button */}
      {value && (
        <button
          onClick={handleClear}
          className="absolute inset-y-0 start-4 flex items-center text-zinc-500 hover:text-zinc-300 transition-colors"
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
