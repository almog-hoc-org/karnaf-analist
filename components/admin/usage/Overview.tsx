"use client";

import CollapsibleCard from "@/components/admin/CollapsibleCard";
import KpiTile from "@/components/admin/KpiTile";
import UsageTrendChart from "@/components/admin/UsageTrendChart";
import BarList from "@/components/admin/BarList";
import InsightBoard from "@/components/admin/usage/InsightBoard";
import { humanSeconds } from "@/components/AdminUserUsageTable";
import { pctChange, share, type UsagePayload } from "@/lib/usagePayload";
import type { InsightTab } from "@/lib/usageInsights";

/**
 * The tab that answers "how is the site doing" before any question is asked.
 *
 * Six headline numbers, in the order the frameworks rank them: audience size,
 * then whether that audience was engaged, then whether it came back — because
 * a rise in the first with no movement in the other two is a leaky bucket, and
 * that is the single most common way a dashboard flatters a product.
 *
 * The insight board sits ABOVE the numbers, because the KPI row answers "what
 * are the numbers" and the board answers "what should I do about them" — and
 * the second question is the one the operator arrived with. It replaced a card
 * of three hand-picked findings that did half the job.
 */

const DEVICE_HE: Record<string, string> = {
  mobile: "📱 מובייל", tablet: "📲 טאבלט", desktop: "💻 מחשב", unknown: "לא ידוע",
};

export default function Overview({ data, onNavigate }: { data: UsagePayload; onNavigate?: (tab: InsightTab) => void }) {
  const { compare, visitors: vis, shape, engagement, sticky, summary } = data;
  const cur = compare.current, prev = compare.previous;
  const series = (pick: (d: (typeof data.trend)[number]) => number) => data.trend.map(pick);

  return (
    <div className="space-y-3">
      <InsightBoard data={data} onNavigate={onNavigate} />

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
