/**
 * One definition of the brand's outward-facing links and assets.
 *
 * WHY A MODULE AND NOT JUST MARKUP
 * The course URL, the WhatsApp number and the mascot are about to appear in the
 * header, the footer, a banner and the feedback widget. A phone number typed
 * into four components is a phone number that will eventually be wrong in one
 * of them, and the one nobody notices is the one a customer tries to reach.
 *
 * Business identity (company id, support email, response time) already lives in
 * lib/legal.ts and stays there — that file is quoted verbatim by the privacy
 * notice and the terms, which counsel approved. This holds the marketing
 * surface only, so a change to a banner can never edit a legal document.
 */

export const BRAND = {
  name: "קרנף נדל״ן",
  productName: "קרנף אנליסט",

  /** The comprehensive course — the one commercial call to action on the site. */
  courseUrl: "https://www.karnafnadlan.com/course",

  /**
   * Business WhatsApp.
   *
   * Two forms because they are not interchangeable: `display` is what a human
   * reads, `wa` is what wa.me requires — international, digits only, no plus and
   * no leading zero. Deriving one from the other in a component is how a link
   * silently stops working when the number changes.
   */
  whatsapp: {
    display: "055-9925725",
    wa: "972559925725",
  },

  /**
   * The mascot, in public/. Referenced through withBasePath() at every use so it
   * keeps resolving if the site ever moves under a sub-path.
   *
   * ⚠️ The favicon is a SEPARATE file at app/icon.png. Next's App Router picks
   * that path up by convention and emits the tab icon from it; pointing at
   * public/ instead would leave the generic default in the tab, which is exactly
   * the thing being fixed.
   */
  mascot: "/karnaf.png",
} as const;

/** Prefilled WhatsApp link. The text is a starting point the sender can edit. */
export function whatsappUrl(message = "היי, הגעתי מקרנף אנליסט"): string {
  return `https://wa.me/${BRAND.whatsapp.wa}?text=${encodeURIComponent(message)}`;
}
