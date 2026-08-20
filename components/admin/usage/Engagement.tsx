"use client";

import CollapsibleCard from "@/components/admin/CollapsibleCard";
import CohortGrid from "@/components/admin/CohortGrid";
import BarList from "@/components/admin/BarList";
import DataTable from "@/components/admin/DataTable";
import PageName from "@/components/admin/PageName";
import { humanSeconds } from "@/components/AdminUserUsageTable";
import { labelForPath, sectionLabel } from "@/lib/pageLabels";
import { NOT_YET, share, type UsagePayload } from "@/lib/usagePayload";
import type { DepthRow, SectionRow } from "@/lib/events";

/**
 * What people did once they were here, and whether they came back.
 *
 * Retention leads the tab because it leads every framework: it is the closest
 * thing to a single proxy for product-market fit, and unlike traffic it cannot
 * be bought. Everything under it explains the retention number — depth,
 * breadth, and which parts of a page are actually read.
 */

const CTA_HE: Record<string, string> = {
  register: "הרשמה", login: "התחברות", check_price: "בדיקת מחיר",
  calculator: "מחשבון", course_banner: "באנר הקורס", open_deals: "סביבת עבודה",
  all_rankings: "כל הדירוג",
};

export default function Engagement({ data }: { data: UsagePayload }) {
  const bestCohort = data.cohorts.reduce(
    (b, c) => (c.signups && share(c.d7, c.signups) > b ? share(c.d7, c.signups) : b), 0
  );

  return (
    <div className="space-y-3">
      <CollapsibleCard
        id="en-cohorts" defaultOpen
        title="🔁 קוהורטות החזרה"
        summary={data.cohorts.length ? `${data.cohorts.length} שבועות · שיא D7 ${bestCohort}%` : "אין נרשמים"}
        hint="לפי שבוע ההרשמה — כמה מהנרשמים חזרו תוך יום, שבוע וחודש. מספר החזרה יחיד לא יודע להבדיל בין ״המוצר השתפר״ ל״התנועה החודש הייתה גרועה יותר״; טבלה של קוהורטות כן, כי כל שורה היא קבוצה קבועה של אנשים. קריאה מלמעלה למטה בעמודה מראה אם קוהורטות חדשות נשמרות טוב יותר."
      >
        <CohortGrid rows={data.cohorts} />
      </CollapsibleCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <CollapsibleCard
          id="en-lengths" defaultOpen
          title="⏱️ אורך הביקור — התפלגות"
          summary={data.sessionLengths.length ? `${data.sessionLengths.reduce((s, b) => s + b.n, 0)} ביקורים` : "—"}
          hint="ממוצע של שלוש דקות יכול להיות ״כולם שלוש דקות״ או ״רובם עשר שניות ומיעוט עשרים דקות״ — שני מוצרים שונים לגמרי, ורק לשני יש מה לתקן בראש המשפך. ממוצע לא מבדיל ביניהם, התפלגות כן."
        >
          <BarList rows={data.sessionLengths.map((b) => ({ label: b.bucket, value: b.n }))} />
        </CollapsibleCard>

        <CollapsibleCard
          id="en-adoption" defaultOpen
          title="🧩 רוחב אימוץ"
          summary={data.adoption.length ? `${data.adoption.find((b) => b.bucket === "שלושה ומעלה")?.n ?? 0} נגעו ב-3+` : "—"}
          hint="בכמה פיצ׳רים שונים נגע מבקר. רוחב מנבא חזרה הרבה יותר טוב מנפח: מי שצפה בארבעים עמודים מאותו סוג מדפדף, ומי שהשתמש בשלושה כלים שונים מצא שהמוצר שימושי."
        >
          <BarList rows={data.adoption.map((b) => ({ label: b.bucket, value: b.n }))} tone="emerald" />
        </CollapsibleCard>
      </div>

      <CollapsibleCard
        id="en-depth"
        title="📏 עומק קריאה ומסך ראשון"
        summary={data.depth.length ? `חציון ${Math.round(data.depth.reduce((a, d) => a + d.medianPct, 0) / data.depth.length)}% מהעמוד` : "מתחיל להיאסף"}
        hint="״מסך ראשון״ הוא איזה אחוז מהעמוד נראה בלי לגלול בכלל, והוא נחוץ כדי לקרוא את החציון נכון: חציון 34% בעמוד שמסכו הראשון מראה 30% הוא קורא שכמעט לא גלל, ובעמוד שמראה 6% הוא קורא שעבד בשביל זה."
      >
        <DataTable<DepthRow>
          rows={data.depth}
          initialSort="views"
          csvName="page-depth"
          maxRows={10}
          empty={NOT_YET}
          columns={[
            { key: "path", label: "עמוד", render: (r) => <PageName path={r.path} />, sort: (r) => labelForPath(r.path).label, csv: (r) => labelForPath(r.path).label },
            { key: "views", label: "צפיות", align: "end", bar: true, sort: (r) => r.views },
            { key: "medianPct", label: "חציון עומק", align: "end", sort: (r) => r.medianPct, render: (r) => <b>{r.medianPct}%</b> },
            { key: "foldPct", label: "מסך ראשון", align: "end", sort: (r) => r.foldPct, render: (r) => `${r.foldPct}%` },
            { key: "p50", label: "עברו חצי", align: "end", sort: (r) => share(r.p50, r.views), render: (r) => `${share(r.p50, r.views)}%` },
            { key: "p100", label: "עד הסוף", align: "end", sort: (r) => share(r.p100, r.views), render: (r) => `${share(r.p100, r.views)}%` },
          ]}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="en-sections"
        title="🔍 מה נצפה בתוך עמוד עיר"
        summary={data.sections.length ? `הנצפה ביותר: ${sectionLabel(data.sections[0].section)}` : "מתחיל להיאסף"}
        hint="נמדד זמן שהחלק היה באמת על המסך, לא ״נכנס לתצוגה״ — בעמוד ארוך כל חלק נכנס לתצוגה של מי שגלל עד הסוף, ואז ״נראה״ מודד בעצם ״העמוד ארוך״. ״הגיעו״ הוא אחוז מצפיות עמוד העיר: חלק שמגיעים אליו 12% הוא או קבור או לא מבוקש, וטבלת העומק שמעל אומרת מה מהשניים."
      >
        <DataTable<SectionRow>
          rows={data.sections}
          initialSort="totalSeconds"
          csvName="city-sections"
          empty={NOT_YET}
          columns={[
            { key: "section", label: "חלק בעמוד", render: (r) => sectionLabel(r.section), sort: (r) => sectionLabel(r.section) },
            { key: "reachPct", label: "% הגיעו", align: "end", bar: true, sort: (r) => r.reachPct, render: (r) => `${r.reachPct}%` },
            { key: "views", label: "צפיות", align: "end", sort: (r) => r.views },
            { key: "avgSeconds", label: "זמן ממוצע", align: "end", sort: (r) => r.avgSeconds, render: (r) => humanSeconds(r.avgSeconds) },
            { key: "totalSeconds", label: "סה״כ", align: "end", sort: (r) => r.totalSeconds, render: (r) => humanSeconds(r.totalSeconds) },
          ]}
        />
      </CollapsibleCard>

      <CollapsibleCard
        id="en-ctas"
        title="👆 כפתורי מפתח"
        summary={data.ctas.length ? `${data.ctas.reduce((s, c) => s + c.n, 0)} לחיצות` : NOT_YET}
        hint="רשימה סגורה בכוונה. מאזין על כל לחיצה מייצר טבלה שאיש לא קורא ועמדת פרטיות שאי אפשר לנסח במשפט."
      >
        <BarList
          rows={data.ctas.map((c) => ({ label: CTA_HE[c.cta] ?? c.cta, value: c.n, hint: `${c.sessions} ביקורים` }))}
          emptyText={NOT_YET}
        />
      </CollapsibleCard>
    </div>
  );
}
