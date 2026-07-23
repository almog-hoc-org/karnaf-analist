import Link from "next/link";

/**
 * Premium ranking card: tiny uppercase category label, #1 displayed BIG
 * (city + value dominate), places 2–5 as compact rows with a relative
 * mini-bar. Navy brand only; no decorative colors.
 */
interface RankingItem {
  rank: number;
  city: string;
  value: string;
  href: string;
  /** optional numeric for the relative mini-bar (falls back to rank-based) */
  numeric?: number;
}

export default function RankingCard({
  title,
  items,
  icon,
  detailHref,
}: {
  title: string;
  items: RankingItem[];
  icon: string;
  detailHref?: string;
}) {
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  const nums = items.map((i) => i.numeric).filter((v): v is number => v != null && Number.isFinite(v));
  const maxNum = nums.length === items.length ? Math.max(...nums.map(Math.abs)) : null;

  return (
    <div className="glass-card group/card relative overflow-hidden p-5 transition-all hover:-translate-y-0.5">
      {/* category label */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
          {icon} {title}
        </span>
        {detailHref && (
          <Link href={detailHref} className="text-[10px] font-bold text-indigo-600 opacity-0 transition-opacity group-hover/card:opacity-100">
            הדירוג המלא ←
          </Link>
        )}
      </div>

      {/* #1 — the hero */}
      <Link href={first.href} className="mb-4 block rounded-xl border border-indigo-100 bg-gradient-to-l from-indigo-50/80 to-white p-3.5 transition-colors hover:border-indigo-300">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black text-white shadow-sm shadow-indigo-600/30">1</span>
            <span className="truncate text-lg font-black text-slate-900">{first.city}</span>
          </div>
          <span dir="ltr" className="shrink-0 text-xl font-black tabular-nums text-indigo-700">{first.value}</span>
        </div>
      </Link>

      {/* 2–5 — compact rows with relative bars */}
      <ul className="space-y-2">
        {rest.map((it) => (
          <li key={it.rank}>
            <Link href={it.href} className="group/row flex items-center gap-2.5">
              <span className="w-4 shrink-0 text-center text-[11px] font-black text-slate-400">{it.rank}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-slate-800 group-hover/row:text-indigo-700">{it.city}</span>
                {maxNum != null && maxNum > 0 && (
                  <span className="spark-bar mt-1 block">
                    <span
                      className="spark-fill block bg-indigo-300"
                      style={{ width: `${Math.max(6, (Math.abs(it.numeric!) / maxNum) * 100)}%` }}
                    />
                  </span>
                )}
              </span>
              <span dir="ltr" className="shrink-0 text-[13px] font-bold tabular-nums text-slate-700">{it.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
