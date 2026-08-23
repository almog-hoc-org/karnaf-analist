import Link from "next/link";
import Icon from "@/components/Icon";

/**
 * A ranking, as a table.
 *
 * WHAT THIS REPLACED, AND WHY (operator, 8/2026)
 * The card used to render #1 as a separate hero block — its own border, its own
 * padding, a 32px numbered square, the name at text-lg and the value on a line
 * of its own — and places 2–5 as thin flex rows beneath it. Two consequences,
 * both marked on the screenshot:
 *
 *   - The card opened with a heavy slab and ended with four hairlines, so the
 *     lower half read as empty even before any stretching.
 *   - Nothing lined up. Each row was `flex` with the value pushed to `ms-auto`,
 *     so a long city name shoved its number left and a short one left a gap.
 *     Five values that cannot be read down a column are five values that cannot
 *     be compared, which is the only reason to put them in a list.
 *
 * A table fixes both by construction: cells align, and #1 is emphasised INSIDE
 * the same grid instead of being a different component.
 *
 * HEIGHT COMES FROM CONTENT. `h-full` is gone from the root, and the rankings
 * grid on the home page carries `card-grid-auto` (app/globals.css) so a card
 * with five short rows is no longer padded out to match a taller neighbour.
 * The `.card-grid` equal-height rule still applies everywhere else, where
 * uniform tiles genuinely want it.
 *
 * WIDTH COMES FROM CONTENT TOO: `table-auto`, no per-column min-widths, and the
 * secondary badge moved UNDER the value rather than beside it — as a sibling it
 * set the value column's width for every other row.
 */
interface RankingItem {
  rank: number;
  city: string;
  value: string;
  href: string;
  /** optional numeric for the relative mini-bar (falls back to rank-based) */
  numeric?: number;
  /** secondary metric in its OWN visual channel (amber chip) — e.g. the
   *  inventory ranking's "X שנים למכירה" pace, which used to blend into the
   *  unit count as one unreadable string (operator spec 8/2026) */
  badge?: string;
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
  const nums = items.map((i) => i.numeric).filter((v): v is number => v != null && Number.isFinite(v));
  const maxNum = nums.length === items.length ? Math.max(...nums.map(Math.abs)) : null;

  return (
    <div className="glass-card group/card relative flex flex-col overflow-hidden p-4 transition-all hover:-translate-y-0.5 sm:p-5">
      <div className="mb-3 min-w-0">
        <span className="block break-words text-2xs font-black uppercase leading-snug tracking-wide text-slate-400">
          <Icon name={icon} size="1em" /> {title}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full table-auto text-center text-xs">
          <tbody className="divide-y divide-slate-100">
            {items.map((it, i) => {
              const first = i === 0;
              return (
                <tr key={it.rank} className={first ? "bg-indigo-50/70" : "hover:bg-slate-50"}>
                  {/* rank */}
                  <td className="px-1.5 py-2 align-middle sm:px-2">
                    <span
                      className={`inline-flex items-center justify-center rounded-full text-2xs font-black ${
                        first ? "h-6 w-6 bg-indigo-600 text-white shadow-sm shadow-indigo-600/30" : "h-5 w-5 bg-slate-100 text-slate-600"
                      }`}
                    >
                      {it.rank}
                    </span>
                  </td>

                  {/* city + relative bar */}
                  <td className="px-1.5 py-2 align-middle sm:px-2">
                    <Link
                      href={it.href}
                      className={`break-words font-bold leading-tight text-slate-900 hover:text-indigo-700 hover:underline ${
                        first ? "text-sm" : ""
                      }`}
                    >
                      {it.city}
                    </Link>
                    {maxNum != null && maxNum > 0 && (
                      <span className="spark-bar mx-auto mt-1 block max-w-[80px]">
                        <span
                          className="spark-fill block bg-indigo-300"
                          style={{ width: `${Math.max(6, (Math.abs(it.numeric!) / maxNum) * 100)}%` }}
                        />
                      </span>
                    )}
                  </td>

                  {/* value (+ badge on its own line, so it never widens the column) */}
                  <td className="px-1.5 py-2 align-middle sm:px-2">
                    <span
                      dir="ltr"
                      className={`block whitespace-nowrap tabular-nums ${
                        first ? "text-base font-black text-indigo-700" : "text-xs font-bold text-slate-700"
                      }`}
                    >
                      {it.value}
                    </span>
                    {it.badge && (
                      <span className="mt-0.5 inline-block rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-700">
                        {it.badge}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailHref && (
        <Link href={detailHref} className="mt-2.5 block text-2xs font-bold text-indigo-600 hover:underline">
          הדירוג המלא ←
        </Link>
      )}
    </div>
  );
}
