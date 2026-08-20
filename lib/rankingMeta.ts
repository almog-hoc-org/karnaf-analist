/**
 * Ranking titles — the one place the name of each ranking is written.
 *
 * WHY ONLY THE TITLES MOVED HERE, AND NOT THE WHOLE CONFIG
 * The full config in app/rankings/[type]/page.tsx builds its subtitles from
 * refYear(), and a module-level const evaluated at import would freeze that
 * value for the life of the server process — the exact bug lib/refYear.ts was
 * written to end (three copies of the reference year drifting apart). Titles
 * carry no live value, so they can be a const; subtitles stay where they are
 * built per render.
 *
 * The usage dashboard reads these so a ranking's name in the admin table and
 * its name on the page cannot disagree. A dashboard that labels a row with a
 * title the site stopped using is worse than one that shows the raw slug: the
 * slug is obviously a slug, and a stale title looks correct.
 */

export type RankingType =
  | "most-expensive" | "highest-gain" | "highest-gain-median"
  | "highest-surplus" | "highest-inventory" | "new-premium";

export const RANKING_TITLES: Record<RankingType, string> = {
  "new-premium": "פרמיית חדשות נמוכה",
  "most-expensive": "היקרות ביותר — יד שנייה",
  "highest-gain": "עליית מחיר — יד שנייה בלבד",
  "highest-gain-median": "עליית מחיר — חציון יד שנייה",
  "highest-surplus": "עודף היצע הגבוה ביותר",
  "highest-inventory": "מלאי דירות לא מכורות",
};
