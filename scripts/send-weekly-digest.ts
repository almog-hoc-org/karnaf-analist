#!/usr/bin/env tsx
/**
 * Send the weekly followed-cities digest.
 *
 * Run: npx tsx scripts/send-weekly-digest.ts            (sends)
 *      npx tsx scripts/send-weekly-digest.ts --dry-run  (prints who would get what)
 *      npx tsx scripts/send-weekly-digest.ts --only me@example.com
 *
 * --dry-run is the default when RESEND_API_KEY is absent, so running this on a
 * laptop cannot mail real people by accident.
 *
 * Scheduling: weekly, from the same systemd timers as the nightly pipeline.
 * Deliberately NOT a pipeline stage — a mail failure must never block the data
 * publish, and a data failure must never send a digest built from half-written
 * aggregates.
 */
import { buildDigest, digestHtml, digestText } from "../lib/digest";

const BATCH = 90; // Resend's batch endpoint caps at 100 per call

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  const dry = args.includes("--dry-run") || !key || !from;

  let recipients = await buildDigest();
  if (only) recipients = recipients.filter((r) => r.email === only);

  if (!recipients.length) {
    console.log("weekly-digest: אין נמענים עם ערים במעקב ונתונים להצגה — לא נשלח דבר");
    return;
  }

  if (dry) {
    console.log(
      `weekly-digest [יבש]: ${recipients.length} נמענים` +
      (key && from ? "" : " · RESEND_API_KEY/NOTIFY_FROM_EMAIL חסרים, לכן לא נשלח")
    );
    for (const r of recipients.slice(0, 5)) {
      console.log(`  ${r.email} — ${r.cities.length} ערים`);
      for (const c of r.cities) {
        console.log(
          `     ${c.city}: ${c.sqm == null ? "—" : Math.round(c.sqm).toLocaleString("he-IL")} ₪/מ״ר (${c.priceYear}) · ` +
          `${c.changePct == null ? "—" : c.changePct.toFixed(1) + "%"}` +
          (c.subsidizedYear ? ` · ⚠ מחיר למשתכן ${c.subsidizedYear}` : "")
        );
      }
    }
    if (recipients.length > 5) console.log(`  … ועוד ${recipients.length - 5} נמענים`);
    return;
  }

  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(batch.map((r) => ({
          from,
          to: [r.email],
          subject: `הערים שלך השבוע — ${r.cities.map((c) => c.city).slice(0, 3).join(", ")}`,
          html: digestHtml(r),
          text: digestText(r),
        }))),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) sent += batch.length;
      else {
        failed += batch.length;
        if (errors.length < 5) errors.push(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
      }
    } catch (e) {
      failed += batch.length;
      if (errors.length < 5) errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`weekly-digest: נשלחו ${sent}, נכשלו ${failed}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  // A partial failure is still a failure: the operator has to know some people
  // did not get their digest, and a green exit code would hide exactly that.
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
