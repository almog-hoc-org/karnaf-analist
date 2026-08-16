/**
 * Visual reordering for Hebrew inside satori (next/og).
 *
 * Satori implements no bidi algorithm at all: it lays glyphs out in the order
 * the string stores them, left to right. Hebrew is stored in logical order, so
 * "נתניה" comes out as "הינתנ" — a real, shipped-looking card that reads
 * backwards to every Hebrew speaker. This was caught only by rendering the PNG
 * and looking at it; every automated check said 200 OK.
 *
 * Browsers do this reordering natively (dir="rtl"), which is why nothing else
 * on the site needs it. It is required ONLY for the OG image.
 *
 * The transform is the simple case of the bidi algorithm, which is all this
 * card needs: reverse the order of runs, reverse the characters inside RTL
 * runs, and leave LTR runs (numbers, ₪ amounts, latin domain names) internally
 * intact so "12,345" does not become "543,21".
 */

const RTL = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const LTR = /[A-Za-z0-9]/;
const SPACE = /\s/;

type Kind = "rtl" | "ltr" | "space";

export function toVisualRtl(input: string): string {
  if (!RTL.test(input)) return input; // nothing Hebrew — leave it exactly as is

  const chars = [...input];

  // 1. Classify. Neutrals (punctuation) are resolved by their NEIGHBOURS, which
  //    is the bidi algorithm's N1 rule in miniature: a comma between two digits
  //    belongs to the number, the same comma between two Hebrew words belongs
  //    to the Hebrew. Without this, "12,345" split into two runs around an
  //    RTL comma and came out as "345,12".
  const kinds: Kind[] = chars.map((ch) =>
    SPACE.test(ch) ? "space" : RTL.test(ch) ? "rtl" : LTR.test(ch) ? "ltr" : "neutral" as Kind
  );
  for (let i = 0; i < kinds.length; i++) {
    if ((kinds[i] as string) !== "neutral") continue;
    let prev: Kind | null = null;
    for (let j = i - 1; j >= 0; j--) if (kinds[j] !== "space" && (kinds[j] as string) !== "neutral") { prev = kinds[j]; break; }
    let next: Kind | null = null;
    for (let j = i + 1; j < kinds.length; j++) if (kinds[j] !== "space" && (kinds[j] as string) !== "neutral") { next = kinds[j]; break; }
    kinds[i] = prev === "ltr" && next === "ltr" ? "ltr" : "rtl";
  }

  // 2. Group into runs. Whitespace is its own run: folded into a neighbour it
  //    lands on the wrong side of the reversal.
  const runs: Array<{ kind: Kind; text: string }> = [];
  chars.forEach((ch, i) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kinds[i]) last.text += ch;
    else runs.push({ kind: kinds[i], text: ch });
  });

  // 3. Reverse run order; reverse characters only inside RTL runs.
  return runs
    .reverse()
    .map((r) => (r.kind === "rtl" ? [...r.text].reverse().join("") : r.text))
    .join("");
}
