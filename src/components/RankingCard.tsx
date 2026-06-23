"use client";

import Link from "next/link";
import { motion } from "framer-motion";

interface RankingItem {
  rank: number;
  city: string;
  value: string;
  href: string;
}

interface RankingCardProps {
  title: string;
  items: RankingItem[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: "easeOut" },
  },
};

const rankColors: Record<number, string> = {
  1: "text-amber-400",
  2: "text-zinc-300",
  3: "text-amber-700",
};

export default function RankingCard({ title, items }: RankingCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors duration-300"
    >
      {/* Card header */}
      <div className="px-5 py-4 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      </div>

      {/* Ranked list */}
      {items.length === 0 ? (
        <div className="px-5 py-8 text-center text-zinc-500 text-sm">
          אין נתונים
        </div>
      ) : (
        <motion.ul
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="divide-y divide-zinc-800/60"
        >
          {items.map((item) => (
            <motion.li key={item.rank} variants={itemVariants}>
              <Link
                href={item.href}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-zinc-800/60 transition-colors duration-150 group"
              >
                {/* Rank badge */}
                <span
                  className={`text-sm font-bold w-6 text-center flex-shrink-0 ${
                    rankColors[item.rank] ?? "text-zinc-500"
                  }`}
                >
                  {item.rank}
                </span>

                {/* City name */}
                <span className="flex-1 text-sm font-medium text-zinc-100 group-hover:text-cyan-400 transition-colors truncate">
                  {item.city}
                </span>

                {/* Value */}
                <span className="text-sm font-semibold text-cyan-400 flex-shrink-0">
                  {item.value}
                </span>
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </motion.div>
  );
}
