/**
 * Feedback kinds and labels — the part BOTH the browser and the server need.
 *
 * Kept separate from lib/feedback.ts on purpose: that module imports appDb,
 * which pulls in better-sqlite3 and therefore Node's `fs`. A client component
 * importing anything from it drags the whole database driver into the browser
 * bundle and fails the build with "Can't resolve 'fs'". Splitting the pure
 * constants out keeps the widget's import graph free of server-only code.
 */

export type FeedbackKind = "bug" | "idea" | "wrong_data" | "rating";

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ["bug", "idea", "wrong_data", "rating"] as const;

export const KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "משהו לא עובד",
  idea: "רעיון לשיפור",
  /** The most valuable category: a reader who spots a wrong number. */
  wrong_data: "נתון נראה שגוי",
  rating: "דירוג כללי",
};
