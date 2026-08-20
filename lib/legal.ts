/**
 * Business and legal facts, in ONE place.
 *
 * These strings appear across the privacy notice, the terms and the
 * accessibility statement. Duplicating them is how a phone number ends up
 * correct on one page and stale on another — and in a legal notice, a contact
 * detail nobody answers is worse than no detail at all.
 */

export const BUSINESS = {
  name: "קרנף נדל״ן",
  companyId: "558557872",
  email: "karnaf.yazamut@gmail.com",
  phone: "055-9966175",
  /** tel: href — no separators */
  phoneHref: "+972559966175",
  /** Response window committed to in the privacy notice. */
  responseDays: 14,
  jurisdiction: "תל אביב-יפו",
} as const;

/**
 * Retention periods. THESE ARE ENFORCED IN CODE, not just stated.
 *
 * A retention policy that only exists in a document is a claim; one wired to a
 * scheduled job is a fact. scripts/prune-retention.ts reads these constants and
 * runs nightly, so the notice and the database cannot drift apart.
 *
 * Chosen to be defensible and conservative: keep what is genuinely needed to
 * run and improve the service, and no longer.
 */
export const RETENTION = {
  /**
   * Behavioural events, in RAW form.
   *
   * Was 180 days, on the reasoning that a trend needs a season. That reasoning
   * no longer applies to the raw rows: the nightly usage roll-up
   * (scripts/rollup-usage.ts) keeps the daily aggregates permanently, so the
   * trend survives while the row-level log — which for a signed-in account is
   * personal data — does not need to. Keeping identifiable rows longer than
   * they are used for is the thing a retention policy exists to prevent.
   */
  eventsDays: 90,
  /**
   * Feedback. Long enough that a bug reported once is still traceable when it
   * finally gets fixed, and that a feature request can be revisited.
   */
  feedbackDays: 730, // 24 months
  /**
   * Expired sessions. Already swept on login; the job is the backstop for an
   * account that simply stops being used.
   */
  expiredSessionsDays: 30,
  /** Database backups kept on disk. */
  backupCopies: 10,
} as const;

/** Human-readable versions for the notice, so prose and code agree by construction. */
export const RETENTION_HE = {
  events: `${RETENTION.eventsDays} יום`,
  feedback: `${Math.round(RETENTION.feedbackDays / 365 * 12)} חודשים`,
  sessions: `${RETENTION.expiredSessionsDays} יום לאחר פקיעה`,
  backups: `${RETENTION.backupCopies} עותקים אחרונים`,
} as const;
