import Link from "next/link";
import type { Coverage } from "@/lib/coverage";
import { isProminent } from "@/lib/coverage";
import Icon from "@/components/Icon";

/**
 * Tells the reader how much of this city's decade is actually behind the chart.
 *
 * The wording is deliberately about US, not about the city. "We hold 21 deals"
 * is a statement about our coverage; "this city has 21 deals" would be a claim
 * about a real market that we cannot support — the source reports transactions
 * in these places that its own detail endpoint will not return, so we genuinely
 * do not know how many there are. Getting that distinction wrong would publish
 * a false claim about somebody's town.
 *
 * Nothing here is per-city text. Every number comes from lib/coverage.ts, which
 * derives them from the series already on the page, so a locality that improves
 * loses its notice without anyone editing a list.
 *
 * The footer used to end "we are working on completing coverage." That was true
 * while the gap looked like a collection bug. It is not any more: the nadlan
 * channel now pulls a locality's full recorded history, and for the small Druze
 * and Arab towns that history is genuinely thin — עספיא holds 27 sales across
 * the last decade, 2–5 a year, which is the real rate and not a number we can
 * raise by collecting harder. Promising to "complete" it would be a promise we
 * cannot keep, so the notice states what the sample is and stops there.
 */
export default function CoverageNotice({ coverage, cityName }: { coverage: Coverage; cityName: string }) {
  const { level, coveredYears, span, totalDeals } = coverage;
  if (level === "ok" || level === "partial") return null;

  const n = (v: number) => v.toLocaleString("he-IL");

  const copy: Record<string, { title: string; body: React.ReactNode }> = {
    none: {
      title: "אין נתוני עסקאות ל" + cityName,
      body: <>לא הצלחנו לאסוף עסקאות ליישוב הזה. אין כאן גרף מחירים כי אין ממה לבנות אותו.</>,
    },
    sparse: {
      title: "כיסוי חלקי מאוד",
      body: (
        <>
          במאגר שלנו <strong>{n(totalDeals)} עסקאות</strong> ב{cityName} בעשור האחרון, ו
          <strong>אף שנה</strong> אינה מגיעה למספר המינימלי שנדרש כדי להציג נקודת מחיר אמינה.
          מה שמוצג כאן הוא חלקי, ולא נכון להסיק ממנו על מגמת המחירים ביישוב.
        </>
      ),
    },
    thin: {
      title: "כיסוי חלקי",
      body: (
        <>
          במאגר שלנו <strong>{n(totalDeals)} עסקאות</strong> ב{cityName}, ורק{" "}
          <strong>{coveredYears} מתוך {span} השנים</strong> מגיעות למספר המינימלי לנקודת מחיר.
          הגרף מציג את מה שיש — קראו אותו כאינדיקציה, לא כמדד.
        </>
      ),
    },
  };

  const c = copy[level];
  if (!c) return null;

  return (
    <div
      role="note"
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950"
    >
      <p className="mb-1 font-black">
        <span aria-hidden className="me-1.5"><Icon name="warning" size="1em" /></span>
        {c.title}
      </p>
      <p>{c.body}</p>
      <p className="mt-2 text-xs text-amber-900">
        אלה העסקאות שבמאגר שלנו ליישוב — מדגם קטן מכדי לבסס עליו מגמת מחירים אמינה, ולא בהכרח כל
        העסקאות שהיו בו.{" "}
        <Link href="/methodology" className="font-bold underline hover:no-underline">
          מה זה אומר בדיוק
        </Link>
      </p>
    </div>
  );
}

/** Re-exported so a caller can decide layout without importing two modules. */
export { isProminent };
