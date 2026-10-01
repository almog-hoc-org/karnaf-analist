/**
 * The deal sources that feed the price series and the price-anomaly rules.
 *
 * 'nadlan' is the tax authority's register as captured from nadlan.gov.il;
 * 'mekarkein' is the same register's rows promoted from over.org.il
 * (scripts/promote-mekarkein.ts). One kind of row, so one basis.
 *
 * flag-outlier-deals.ts flags against medians over these sources, and
 * verify-anomalies.ts re-derives the very same medians to prove the flag held.
 * Until 1.10.2026 the second still read 'nadlan' alone while the first read
 * both, the medians disagreed, and the nightly pipeline stopped at the gate.
 * Both import this constant so they cannot drift apart again.
 */
export const PRICE_SOURCES_SQL = "('nadlan','mekarkein')";
