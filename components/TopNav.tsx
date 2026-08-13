"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import Icon from "@/components/Icon";
import BrandMark from "./BrandMark";
import { usePathname, useRouter } from "next/navigation";
import { withBasePath } from "@/lib/basePath";
import { trackSearch } from "@/lib/track";

const NAV_ITEMS = [
  { href: "/", label: "בית" },
  { href: "/cities", label: "ערים" },
  { href: "/compare", label: "השוואה" },
  { href: "/national", label: "ארצי" },
  { href: "/calculators", label: "מחשבונים" },
  // "מקורות" moved to the footer (operator spec 8/2026) — a methodology page
  // is reference material, not a daily destination; the top bar earns its
  // slots by frequency of use.
  { href: "/deals", label: "העסקאות שלי", highlight: true },
];

interface CityHit {
  name: string;
}

export default function TopNav({ cities, user, credits }: { cities: string[]; user?: { name: string } | null; credits?: number | null }) {
  const creditsLabel = credits == null ? null : (Number.isInteger(credits) ? String(credits) : credits.toFixed(1));
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false); // mobile menu
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CityHit[]>([]);
  const [focusIdx, setFocusIdx] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setQ("");
    setHits([]);
  }, [pathname]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => {
      const needle = q.trim();
      const matches = cities.filter((c) => c.includes(needle));
      setHits(matches.slice(0, 8).map((name) => ({ name })));
      setFocusIdx(-1);
      // Instrumented here rather than on submit: this box is on EVERY page and
      // had no notion of "no matches" at all — it simply rendered nothing, so a
      // failed search was invisible to the user AND to us. It is also the more
      // used of the site's two search inputs, so measuring only the homepage one
      // would have missed most searches.
      trackSearch(needle, matches.length, "topnav");
    }, 120);
    return () => clearTimeout(t);
  }, [q, cities]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setHits([]);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (name: string) => {
    setQ("");
    setHits([]);
    router.push(`/city/${encodeURIComponent(name)}`);
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:px-6">
        {/* Brand — the mascot, not the indigo square with a letter in it that
            every generated site ships with. Above the fold on every page, so
            this is the one instance worth loading eagerly. */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <BrandMark size={34} priority />
          <span className="text-sm font-extrabold tracking-tight text-slate-900">
            קרנף <span className="text-indigo-600">אנליסט</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="ניווט ראשי">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                isActive(item.href)
                  ? "bg-indigo-50 text-indigo-700"
                  : (item as { highlight?: boolean }).highlight
                    ? "border border-indigo-200 bg-indigo-600/5 text-indigo-700 hover:bg-indigo-50"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* City search */}
        <div ref={boxRef} className="relative mr-auto w-full min-w-0 max-w-[240px] md:max-w-[280px]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && (focusIdx >= 0 ? hits[focusIdx] : hits[0])) go((focusIdx >= 0 ? hits[focusIdx] : hits[0]).name);
              else if (e.key === "Escape") setHits([]);
            }}
            placeholder="חיפוש עיר…"
            aria-label="חיפוש עיר"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          {q.trim() && hits.length === 0 && (
            <div className="absolute top-full z-[100] mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-center text-sm text-slate-500 shadow-xl">
              לא נמצאו ערים תואמות
            </div>
          )}
          {hits.length > 0 && (
            <div className="absolute top-full z-[100] mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              {hits.map((h, i) => (
                <button
                  key={h.name}
                  onMouseDown={(e) => { e.preventDefault(); go(h.name); }}
                  className={`block w-full px-3.5 py-2 text-right text-sm font-medium ${
                    i === focusIdx ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {h.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Account chip — login is OPTIONAL: anonymous visitors keep full access */}
        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          {user ? (
            <>
              {creditsLabel != null && (
                <Link
                  href="/account"
                  title="היתרה שלך — לחץ לפירוט ולהרווחת קרדיטים"
                  className="flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 text-xs font-black text-white shadow-sm transition-colors hover:bg-indigo-700"
                >
                  🪙 {creditsLabel}
                  <span className="font-semibold opacity-80">קרדיטים</span>
                </Link>
              )}
              <Link href="/account" className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100" title="החשבון שלי">
                שלום, {user.name}
              </Link>
              <form action={withBasePath("/logout")} method="post" className="inline">
                <button type="submit" className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 hover:text-slate-700">יציאה</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              התחברות
            </Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="תפריט"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 md:hidden"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            {open ? (
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            ) : (
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu — an OVERLAY, not in-flow: an in-flow block inflated the
          sticky header to ~308px and covered the page (and desynced every
          sticky top-14 offset). The header now stays 56px with the menu open. */}
      <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-x-0 top-14 bottom-0 z-40 bg-slate-900/20 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <motion.nav
            // Grows down out of the header it belongs to (origin at the top
            // edge) and collapses back into it — the panel and its trigger stay
            // spatially connected. bounce 0 because a tap carries no momentum;
            // a spring rather than a duration so a fast open-close-open follows
            // the taps instead of queueing behind a fixed timeline.
            initial={{ opacity: 0, scaleY: 0.92, y: -8 }}
            animate={{ opacity: 1, scaleY: 1, y: 0 }}
            exit={{ opacity: 0, scaleY: 0.92, y: -8 }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
            style={{ transformOrigin: "top" }}
            className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-slate-100 bg-white px-4 py-2 shadow-lg md:hidden"
            aria-label="ניווט נייד"
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-3 text-sm font-semibold ${
                  isActive(item.href) ? "bg-indigo-50 text-indigo-700" : "text-slate-700"
                }`}
              >
                {item.label}
              </Link>
            ))}
            {/* account — reachable on mobile too (was desktop-only and thus unreachable) */}
            <div className="mt-1 border-t border-slate-100 pt-1">
              {user ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                  <Link href="/account" className="flex items-center gap-2 text-sm font-bold text-indigo-700">
                    שלום, {user.name}
                    {creditsLabel != null && (
                      <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-black text-white">🪙 {creditsLabel} קרדיטים</span>
                    )}
                  </Link>
                  <form action={withBasePath("/logout")} method="post" className="inline">
                    <button type="submit" className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-500">יציאה</button>
                  </form>
                </div>
              ) : (
                <Link href="/login" className="block rounded-lg px-3 py-3 text-sm font-semibold text-slate-700">
                  <Icon name="lock" size="1em" /> התחברות
                </Link>
              )}
            </div>
          </motion.nav>
        </>
      )}
      </AnimatePresence>
    </header>
  );
}
