"use client";

import Link from "next/link";
import { motion } from "framer-motion";

interface RankingItem {
  rank: number;
  city: string;
  value: string;
  href: string;
}

type Accent = "amber" | "rose" | "emerald" | "cyan" | "purple";

interface RankingCardProps {
  title: string;
  items: RankingItem[];
  accent?: Accent;
  icon?: string;
  detailHref?: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

// Accent → light-theme styles
const accentStyles: Record<
  Accent,
  { glow: string; headerIcon: string; valueText: string }
> = {
  amber: {
    glow: "glow-amber",
    headerIcon: "bg-amber-100 text-amber-700",
    valueText: "text-amber-700",
  },
  rose: {
    glow: "glow-rose",
    headerIcon: "bg-rose-100 text-rose-700",
    valueText: "text-rose-700",
  },
  emerald: {
    glow: "glow-emerald",
    headerIcon: "bg-emerald-100 text-emerald-700",
    valueText: "text-emerald-700",
  },
  cyan: {
    glow: "glow-cyan",
    headerIcon: "bg-cyan-100 text-cyan-700",
    valueText: "text-cyan-700",
  },
  purple: {
    glow: "glow-purple",
    headerIcon: "bg-purple-100 text-purple-700",
    valueText: "text-purple-700",
  },
};

const rankBadge: Record<number, string> = {
  1: "bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-md shadow-amber-500/30",
  2: "bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-md",
  3: "bg-gradient-to-br from-amber-600 to-amber-700 text-white shadow-md",
};

const rankFallback = "bg-slate-100 text-slate-600 border border-slate-200";

export default function RankingCard({
  title,
  items,
  accent = "cyan",
  icon = "📊",
  detailHref,
}: RankingCardProps) {
  const style = accentStyles[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`kpi-card ${style.glow} p-0 overflow-hidden`}
    >
      {detailHref ? (
        <Link
          href={detailHref}
          className="px-5 py-4 flex items-center gap-3 border-b border-slate-100 hover:bg-slate-50 transition-colors group"
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${style.headerIcon}`}
          >
            {icon}
          </div>
          <h2 className="text-sm font-bold text-slate-900 leading-tight flex-1">{title}</h2>
          <span
            className={`text-xs ${style.valueText} font-bold opacity-0 group-hover:opacity-100 transition-opacity`}
            title="צפה בטבלה המלאה"
          >
            הכל ←
          </span>
        </Link>
      ) : (
        <div className="px-5 py-4 flex items-center gap-3 border-b border-slate-100">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${style.headerIcon}`}
          >
            {icon}
          </div>
          <h2 className="text-sm font-bold text-slate-900 leading-tight">{title}</h2>
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-5 py-8 text-center text-slate-400 text-sm">אין נתונים</div>
      ) : (
        <>
        <motion.ul
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="divide-y divide-slate-100"
        >
          {items.map((item) => {
            const badgeClass = rankBadge[item.rank] ?? rankFallback;
            const isTop = item.rank === 1;
            return (
              <motion.li key={item.rank} variants={itemVariants}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-5 ${
                    isTop ? "py-3.5 bg-amber-50/30" : "py-2.5"
                  } hover:bg-slate-50 transition-colors duration-150 group`}
                >
                  <span
                    className={`${
                      isTop ? "text-xs w-7 h-7" : "text-[10px] w-5 h-5"
                    } font-black rounded-lg flex items-center justify-center flex-shrink-0 ${badgeClass}`}
                  >
                    {item.rank}
                  </span>
                  <span
                    className={`flex-1 ${
                      isTop ? "text-base font-bold" : "text-sm font-medium"
                    } text-slate-800 group-hover:text-slate-900 transition-colors truncate`}
                  >
                    {item.city}
                  </span>
                  <span
                    className={`${
                      isTop ? "text-lg font-extrabold" : "text-sm font-bold"
                    } ${style.valueText} flex-shrink-0 tabular-nums`}
                  >
                    {item.value}
                  </span>
                </Link>
              </motion.li>
            );
          })}
        </motion.ul>
        {detailHref && (
          <Link
            href={detailHref}
            className={`block px-5 py-2.5 text-center text-xs font-bold ${style.valueText} bg-slate-50 hover:bg-slate-100 border-t border-slate-100 transition-colors`}
          >
            צפה בטבלה המלאה ←
          </Link>
        )}
        </>
      )}
    </motion.div>
  );
}
