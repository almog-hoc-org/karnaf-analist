/**
 * The icon set. Line drawings on a 24×24 grid, stroked in currentColor.
 *
 * WHY THIS REPLACED EMOJI
 * The interface carried 240 emoji, 41 distinct ones in section headers and card
 * chips alone. They are the single loudest reason the site read as generated
 * rather than designed, and the reasons are concrete, not taste:
 *
 *   · They are drawn by the OPERATING SYSTEM, so the same page is a different
 *     product on an iPhone, an Android and a Windows laptop. Nothing else on
 *     the site changes shape depending on who is looking at it.
 *   · They cannot take the brand colour. Full-colour glyphs sat inside a petrol
 *     palette chosen deliberately not to be generic, and undid it.
 *   · Their metrics are their own — they do not sit on the text baseline or
 *     scale with font-size, which is why they always look slightly misplaced.
 *   · They carry connotations we did not choose. 💰 next to a price series and
 *     👑 next to a ranking read as a game, not as market research a person is
 *     about to make a six-figure decision on.
 *
 * These inherit colour from their container and scale with it, so an icon in a
 * warning block is warning-coloured and an icon in a heading is heading-sized,
 * with no per-site override.
 *
 * SEMANTIC, NOT PICTORIAL. The 41 emoji collapse to far fewer names on purpose:
 * 🔍 and 🔎 are both `search`, ✓ and ✅ are both `check`, 🏠 🏘 🏢 🏙 are all
 * `building`. Naming by meaning is what keeps a set consistent as it grows —
 * the next person reaches for `trend-up`, not for a new drawing of an arrow.
 *
 * Unknown names render nothing rather than throwing: a missing icon must never
 * be able to take down a page, which is the same rule the mascot follows.
 */
import type { SVGProps } from "react";

// Every path is drawn on the same 24×24 grid with the same 1.75 stroke, which
// is what makes them look like one family rather than a collection.
const PATHS: Record<string, string> = {
  // ── data ────────────────────────────────────────────────────────────
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  "trend-up": "M3 17l6-6 4 4 8-8M21 7v5M21 7h-5",
  "trend-down": "M3 7l6 6 4-4 8 8M21 17v-5M21 17h-5",
  calculator: "M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01",
  ruler: "M3 15L15 3l6 6L9 21zM8 10l2 2M11 7l2 2M5 13l2 2",

  // ── documents ───────────────────────────────────────────────────────
  clipboard: "M9 3h6v3H9zM7 5H5v16h14V5h-2M9 11h6M9 15h4",
  document: "M13 3H7v18h10V7zM13 3v4h4M9 12h6M9 16h4",
  news: "M4 5h13v14H4zM17 9h3v8a2 2 0 01-3 0zM7 8h7M7 12h7M7 16h4",
  book: "M4 4h7v16H4zM13 4h7v16h-7M8 8h.01M17 8h.01",
  tag: "M3 12V5a2 2 0 012-2h7l9 9-9 9zM7.5 7.5h.01",
  attachment: "M17 8l-7 7a2.5 2.5 0 003.5 3.5l7-7a5 5 0 00-7-7l-7 7a7.5 7.5 0 0010.5 10.5L21 15",
  link: "M10 14a4 4 0 006 .5l2-2a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6-.5l-2 2a4 4 0 006 6l1-1",

  // ── places ──────────────────────────────────────────────────────────
  building: "M4 21V7l7-4 7 4v14M4 21h14M9 21v-5h4v5M8 10h.01M13 10h.01M8 13h.01M13 13h.01",
  institution: "M3 10l9-6 9 6M5 10v9M10 10v9M14 10v9M19 10v9M3 21h18",
  construction: "M3 21V11l6-3 6 3v10M15 21V8l6 3v10M3 21h18M6 15h3M18 15h.01",
  bricks: "M3 8h18M3 13h18M3 18h18M9 8v5M15 13v5M9 18v3M15 3v5",
  door: "M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17M4 21h16M14 12h.01",

  // ── people ──────────────────────────────────────────────────────────
  users: "M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7M18 20v-2a4 4 0 00-2.5-3.7M15 3.3a3.5 3.5 0 010 6.8",
  handshake: "M8 12l3-3 3 3 3-3 3 3-5 5-2-2-2 2-5-5 2-2M2 12l3-3",
  crown: "M4 18h16M4 18L3 7l5 4 4-6 4 6 5-4-1 11",
  trophy: "M7 4h10v6a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M10 19h4M9 21h6",

  // ── signals ─────────────────────────────────────────────────────────
  idea: "M9 18h6M10 21h4M12 3a6 6 0 014 10.5V16H8v-2.5A6 6 0 0112 3z",
  warning: "M12 3l9.5 17H2.5zM12 9v5M12 17.5h.01",
  check: "M4 12.5l5.5 5.5L20 7",
  close: "M6 6l12 12M18 6L6 18",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM16.5 16.5L21 21",
  refresh: "M20 12a8 8 0 11-2.5-5.8M20 4v4h-4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6",

  // ── system ──────────────────────────────────────────────────────────
  database: "M12 3c4.5 0 8 1.3 8 3s-3.5 3-8 3-8-1.3-8-3 3.5-3 8-3zM4 6v12c0 1.7 3.5 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.5 3 8 3s8-1.3 8-3",
  package: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  lock: "M6 11h12v10H6zM9 11V7a3 3 0 016 0v4",
  shield: "M12 3l8 3v6c0 4.5-3.2 8.3-8 9.5-4.8-1.2-8-5-8-9.5V6zM9 12l2 2 4-4",
  broom: "M14 3l7 7M13 8l-8 8-2 5 5-2 8-8zM8 13l3 3",

  // ── money & fairness ────────────────────────────────────────────────
  money: "M12 3v18M15.5 7a3.5 3.5 0 00-3.5-2c-2 0-3.5 1.2-3.5 3s1.5 2.6 3.5 3 3.5 1.2 3.5 3-1.5 3-3.5 3a3.5 3.5 0 01-3.5-2",
  gem: "M6 3h12l3 6-9 12L3 9zM3 9h18M9 3L6 9l6 12M15 3l3 6-6 12",
  scale: "M12 3v18M7 21h10M4 7h16l-3 6H7zM12 7L7 13M12 7l5 6",

  // ── communication & access ──────────────────────────────────────────
  chat: "M4 5h16v11H9l-5 4V5zM8 9h8M8 12.5h5",
  accessibility: "M12 3.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM6 9l6 1.5L18 9M12 10.5V15M12 15l-2.5 5.5M12 15l2.5 5.5",

  // The mascot keeps its own shape — a horn in profile. It is the one mark on
  // the site that should NOT look like the rest of the family.
  rhino: "M3 16c0-4 3-7 7.5-7 2 0 3 .5 4.5 1.5L21 6c.5 3-1 5.5-3 6.5V16c0 2-1.5 3.5-3.5 3.5H7c-2.2 0-4-1.5-4-3.5zM8 12.5h.01",
};

/**
 * Aliases from what the code used to say to what the set calls it. Keeping these
 * means a stray emoji in a page nobody has converted yet still renders as a
 * proper icon rather than disappearing.
 */
const ALIASES: Record<string, string> = {
  "📊": "chart", "📈": "trend-up", "📉": "trend-down", "🧮": "calculator", "📐": "ruler",
  "📋": "clipboard", "📑": "clipboard", "📝": "document", "📄": "document", "📰": "news",
  "📚": "book", "🏷": "tag", "📎": "attachment", "🔗": "link",
  "🏠": "building", "🏘": "building", "🏢": "building", "🏙": "building",
  "🏛": "institution", "🏗": "construction", "🚧": "construction", "🧱": "bricks", "🚪": "door",
  "👥": "users", "👯": "users", "🤝": "handshake", "👑": "crown", "🏆": "trophy",
  "💡": "idea", "⚠": "warning", "🚨": "warning", "✓": "check", "✅": "check",
  "✕": "close", "✗": "close", "❌": "close", "🚫": "close",
  "🔍": "search", "🔎": "search", "🔄": "refresh", "🗑": "trash",
  "🗄": "database", "📦": "package", "🔐": "lock", "🔑": "lock", "🛡": "shield", "🧹": "broom",
  "💰": "money", "💎": "gem", "⚖": "scale", "💬": "chat", "📞": "chat", "♿": "accessibility",
  "🦏": "rhino",
};

export type IconName = keyof typeof PATHS | string;

export default function Icon({
  name,
  size = 20,
  className = "",
  ...rest
}: { name: IconName; size?: number | string } & Omit<SVGProps<SVGSVGElement>, "name" | "size">) {
  // Accept a raw emoji too, so a not-yet-converted call site degrades to the
  // right icon instead of to nothing.
  const d = PATHS[name] ?? PATHS[ALIASES[name] ?? ""];
  if (!d) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default: these sit beside a text label that already says
      // what the section is, and a screen reader announcing "chart" before every
      // heading is noise. Pass aria-label to override where an icon stands alone.
      aria-hidden={rest["aria-label"] ? undefined : true}
      focusable="false"
      className={`inline-block shrink-0 align-[-0.125em] ${className}`}
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}
