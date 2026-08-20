"use client";

import CollapsibleCard from "@/components/admin/CollapsibleCard";
import KpiTile from "@/components/admin/KpiTile";
import UsageTrendChart from "@/components/admin/UsageTrendChart";
import BarList from "@/components/admin/BarList";
import PageName from "@/components/admin/PageName";
import { humanSeconds } from "@/components/AdminUserUsageTable";
import { pctChange, share, type UsagePayload } from "@/lib/usagePayload";

/**
 * The tab that answers "how is the site doing" before any question is asked.
 *
 * Six headline numbers, in the order the frameworks rank them: audience size,
 * then whether that audience was engaged, then whether it came back — because
 * a rise in the first with no movement in the other two is a leaky bucket, and
 * that is the single most common way a dashboard flatters a product.
 *
 * The three findings at the bottom are computed, not chosen: the worst dead
 * end, the most-wanted city with thin coverage, the most frequent failed
 * search. They are the answers to "what should I look at first", surfaced so
 * the operator does not have to open five cards to find them.
 */

const DEVICE_HE: Record<string, string> = {
  mobile: "📱 מובייל", tablet: "📲 טאבלט", desktop: "💻 מחשב", unknown: "לא ידוע",
};

export default function Overview({ data }: { data: UsagePayload }) {
  const { compare, visitors: vis, shape, engagement, sticky, summary } = data;
  const cur = compare.current, prev = compare.previous;
  const series = (pick: (d: (typeof data.trend)[number]) => number) => data.trend.map(pick);

  // The three things worth looking at first, derived rather than curated.
  const worstDeadEnd = data.exits
    .filter((e) => e.views >= 5 && e.avgSecondsBeforeExit > 0 && e.avgSecondsBeforeExit < 20)
    .sort((a, b) => b.exits - a.exits)[0];
  const starvedCity = data.cities
    .filter((c) => c.quality === "thin")
    .sort((a, b) => b.views - a.views)[0];
  const topMiss = data.misses[0];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="מבקרים" value={(vis.visitors || shape.sessions).toLocaleString("he-IL")}
          sub={`${shape.sessions.toLocaleString("he-IL")} ביקורים`}
          delta={pctChange(cur.visitors, prev.visitors)} series={series((d) => d.visitors)}
          hint="דפדפנים שונים, עד 180 יום. ביקור הוא לשונית."
        />
        <KpiTile
          label="ביקורים מעורבים" value={`${engagement.engagedPct}%`}
          sub={`${engagement.engaged} מתוך ${engagement.sessions}`}
          delta={null} series={series((d) => d.sessions - d.bounces)}
          hint="הגדרת GA4: מעל 10 שניות, או 2+ עמודים, או פעולה. החליף את שיעור הנטישה."
        />
        <KpiTile
          label="חוזרים" value={`${vis.returningPct}%`}
          sub={`${vis.returning} מבקרים`}
          delta={pctChange(cur.returningVisitors, prev.returningVisitors)}
          series={series((d) => d.returningVisitors)}
          hint="מבקר שנראה ביותר מיום קלנדרי אחד."
        />
        <KpiTile
          label="דביקות DAU/WAU" value={`${sticky.pct}%`}
          sub={`${sticky.dau} ביום · ${sticky.wau} בשבוע`}
          delta={null}
          hint="כמה מהקהל השבועי מגיע ביום ממוצע. 20%+ הוא מוצר שחוזרים אליו מעצמם."
        />
        <KpiTile
          label="זמן ממוצע לביקור" value={humanSeconds(summary.avgSessionSeconds)}
          sub={`${Math.round(cur.seconds / 60).toLocaleString("he-IL")} דק׳ בסה״כ`}
          delta={pctChange(cur.seconds, prev.seconds)} series={series((d) => d.seconds)}
        />
        <KpiTile
          label="הרשמות" value={cur.signups.toLocaleString("he-IL")}
          sub={`${cur.unlocks} פתיחות ערים`}
          delta={pctChange(cur.signups, prev.signups)} series={series((d) => d.signups)}
        />
      </div>

      <CollapsibleCard
        id="ov-trend" defaultOpen
        title="📈 מגמה יומית"
        summary={`${data.rollup.days} ימים בצבירה`}
        hint="הפער בין שטח המבקרים לקו החוזרים הוא סיפור הרכישה מול השימור: שטח שגדל בזמן שהקו שטוח הוא דלי מחורר. מהצבירה הלילית, כלומר ימים שלמים בלבד — היום הנוכחי חסר בכוונה ולא מצויר כקריסה כל בוקר."
      >
        <UsageTrendChart rows={data.trend} />
      </CollapsibleCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <CollapsibleCard
          id="ov-devices" defaultOpen
          title="📱 מכשירים"
          summary={vis.devices[0] ? `${DEVICE_HE[vis.devices[0].device] ?? ""} מוביל` : "—"}
          hint="נגזר מרוחב המסך וסוג המצביע, לא מ-user-agent. נספר לפי מבקרים ולא לפי ביקורים, כדי שאדם שגולש גם בטלפון וגם במחשב לא ייספר כשני קהלים."
        >
          <BarList
            rows={(vis.devices.length ? vis.devices : summary.devices.map((d) => ({ device: d.device, visitors: d.sessions })))
              .map((d) => ({ label: DEVICE_HE[d.device] ?? d.device, value: d.visitors }))}
          />
        </CollapsibleCard>

        <CollapsibleCard
          id="ov-sources" defaultOpen
          title="🔗 מקור תנועה"
          summary={`${data.sources.length} מקורות`}
          hint="דומיין מפנה בלבד — כתובת חיפוש מלאה עלולה לשאת את מה שהגולש הקליד במנוע, ולזה אין לנו שימוש."
        >
          <BarList rows={data.sources.map((s) => ({ label: <span dir="ltr">{s.source}</span>, value: s.sessions }))} />
        </CollapsibleCard>
      </div>

      <CollapsibleCard
        id="ov-findings" defaultOpen
        title="🎯 מה לבדוק קודם"
        summary="שלושה ממצאים אוטומטיים"
        hint="נגזרים מהנתונים בכל טעינה, לא נבחרים ידנית — כדי שלא צריך לפתוח חמישה כרטיסים כדי לגלות מה חשוב היום."
      >
        <div className="space-y-2 text-xs">
          {worstDeadEnd ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
              <span aria-hidden>🚪</span>
              <div className="min-w-0">
                <PageName path={worstDeadEnd.path} />
                <p className="mt-0.5 text-slate-600">
                  {worstDeadEnd.exits} ביקורים הסתיימו כאן אחרי {humanSeconds(worstDeadEnd.avgSecondsBeforeExit)} בלבד —
                  הגיעו ונטשו. שווה לפתוח את העמוד ולראות מה חסר בו.
                </p>
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">אין מבוי סתום בולט בתקופה.</p>
          )}

          {starvedCity && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
              <span aria-hidden>🏙️</span>
              <p className="min-w-0 text-slate-700">
                <b>{starvedCity.city}</b> נצפתה {starvedCity.views} פעמים והמדגם בה דל.
                זו העיר שהכי כדאי להשלים בה איסוף — יש עליה ביקוש ואין מה להראות.
              </p>
            </div>
          )}

          {topMiss && (
            <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2">
              <span aria-hidden>🔎</span>
              <p className="min-w-0 text-slate-700">
                חיפשו <b>&ldquo;{topMiss.term}&rdquo;</b> {topMiss.n} פעמים ולא מצאו כלום.
                או שהיישוב חסר, או שהוא נכתב אצלנו אחרת.
              </p>
            </div>
          )}
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id="ov-shape"
        title="📐 צורת הביקור"
        summary={`${shape.pagesPerVisit.toFixed(1)} עמודים לביקור`}
      >
        <BarList
          rows={[
            { label: "עמודים לביקור", value: Number(shape.pagesPerVisit.toFixed(1)) },
            { label: "שיעור נטישה %", value: shape.bounceRatePct },
            { label: "ביקורים של מחוברים", value: shape.signedInSessions },
            { label: "מבקרים חוזרים %", value: vis.returningPct },
            { label: "מעורבים %", value: engagement.engagedPct },
          ]}
        />
        <p className="mt-2 text-2xs text-slate-400">
          {share(shape.signedInSessions, shape.sessions)}% מהביקורים היו של משתמש מחובר.
        </p>
      </CollapsibleCard>
    </div>
  );
}
