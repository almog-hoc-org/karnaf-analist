/**
 * Uniform source labeling (user rule): every section states whether its numbers
 * come from the INDEPENDENT transaction repository or from an external source.
 *   <SourceBadge kind="internal" />               → <Icon name="source-own" size="1em" /> מאגר העסקאות העצמאי
 *   <SourceBadge kind="external" name='למ"ס' />   → 🏛️ מקור חיצוני: למ"ס
 */
import Icon from "@/components/Icon";

export default function SourceBadge({
  kind,
  name,
  className = "",
}: {
  kind: "internal" | "external";
  name?: string;
  className?: string;
}) {
  if (kind === "internal") {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-2xs font-bold text-indigo-700 ${className}`}
        title="נאסף ונותח באופן בלתי-תלוי מעסקאות אמת של רשות המסים; יד-שנייה מסווגת לפי שנת בנייה (4+ שנים)"
      >
        <Icon name="source-own" size="1em" /> מאגר העסקאות העצמאי
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-2xs font-bold text-slate-600 ${className}`}
      title="נתון ממקור חיצוני — מוצג כהשלמה למאגר העסקאות העצמאי"
    >
      <Icon name="source-official" size="1em" /> מקור חיצוני{name ? `: ${name}` : ""}
    </span>
  );
}
