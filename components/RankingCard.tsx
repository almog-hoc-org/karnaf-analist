import Link from "next/link";
import Icon from "@/components/Icon";

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
    <div className="glass-card group/card relative flex h-full flex-col overflow-hidden p-5 transition-all hover:-translate-y-0.5">
      {/* category label — no hidden hover-link stealing width; modest tracking for Hebrew */}
      <div className="mb-4 min-w-0">
        <span className="block break-words text-2xs font-black uppercase leading-snug tracking-wide text-slate-400">
          <Icon name={icon} size="1em" /> {title}
        </span>
      </div>

      {/* #1 — the hero. Name gets a FULL row (never competes with the value for width);
          the value sits on its own line below — nothing can clip at any card width. */}
      <Link href={first.href} className="mb-4 block rounded-xl border border-indigo-100 bg-gradient-to-l from-indigo-50/80 to-white p-3.5 transition-colors hover:border-indigo-300">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black text-white shadow-sm shadow-indigo-600/30">1</span>
          <span className="min-w-0 flex-1 break-words text-lg font-black leading-tight text-slate-900">{first.city}</span>
        </div>
        <div dir="ltr" className="mt-2 text-right text-xl font-black tabular-nums leading-none text-indigo-700">{first.value}</div>
      </Link>

      {/* 2–5 — rows WRAP when tight: the value drops under the name instead of clipping */}
      <ul className="space-y-2">
        {rest.map((it) => (
          <li key={it.rank}>
            <Link href={it.href} className="group/row flex flex-wrap items-start gap-x-2.5 gap-y-0.5">
              <span className="mt-0.5 w-4 shrink-0 text-center text-2xs font-black text-slate-400">{it.rank}</span>
              <span className="min-w-0 flex-1 basis-24">
                <span className="block break-words text-xs font-bold leading-tight text-slate-800 group-hover/row:text-indigo-700">{it.city}</span>
                {maxNum != null && maxNum > 0 && (
                  <span className="spark-bar mt-1 block">
                    <span
                      className="spark-fill block bg-indigo-300"
                      style={{ width: `${Math.max(6, (Math.abs(it.numeric!) / maxNum) * 100)}%` }}
                    />
                  </span>
                )}
              </span>
              <span dir="ltr" className="ms-auto whitespace-nowrap text-xs font-bold tabular-nums text-slate-700">{it.value}</span>
            </Link>
          </li>
        ))}
      </ul>
      {detailHref && (
        <Link href={detailHref} className="mt-3 block text-2xs font-bold text-indigo-600 hover:underline">
          הדירוג המלא ←
        </Link>
      )}
    </div>
  );
}
