#!/usr/bin/env tsx
/**
 * Grant (or revoke) unlimited access by email, from the server.
 *
 * The admin screen has a button for this, and this script exists for the same
 * reason the pipeline has a CLI: the operator asks for a change while nobody is
 * sitting in front of the dashboard, and a one-line command that reports
 * exactly what it did beats a screen-share.
 *
 * Idempotent, and it does NOT create accounts. An email with no account is
 * reported as such rather than quietly doing nothing — "granted" printed for a
 * typo is how someone finds out weeks later that they never had access.
 *
 * Run inside the container:
 *   npx tsx scripts/set-unlimited.ts a@b.com c@d.com
 *   npx tsx scripts/set-unlimited.ts --off a@b.com
 *   npx tsx scripts/set-unlimited.ts --list
 */
import { appDb } from "../lib/appDb";
import { setUnlimited, isUnlimited, UNLIMITED_TIER } from "../lib/credits";

function main() {
  const args = process.argv.slice(2);
  const off = args.includes("--off");
  const emails = args.filter((a) => !a.startsWith("--")).map((e) => e.trim().toLowerCase());

  if (args.includes("--list") || !emails.length) {
    const rows = appDb().prepare(
      "SELECT id, email, name FROM users WHERE tier=? ORDER BY id"
    ).all(UNLIMITED_TIER) as Array<{ id: number; email: string; name: string }>;
    if (!rows.length) {
      console.log("אין כרגע חשבונות עם גישה ללא הגבלה.");
    } else {
      console.log(`חשבונות עם גישה ללא הגבלה (${rows.length}):`);
      for (const r of rows) console.log(`  #${r.id}  ${r.email}  (${r.name})`);
    }
    if (!emails.length && !args.includes("--list")) {
      console.log("\nשימוש: npx tsx scripts/set-unlimited.ts <email> [<email>…] [--off]");
    }
    return;
  }

  // Emails are stored lowercase by registerUser, but a Google sign-in or a
  // hand-inserted row could differ in case — compare case-insensitively rather
  // than reporting "not found" for an account that plainly exists.
  const find = appDb().prepare("SELECT id, email, name FROM users WHERE lower(email)=?");
  let changed = 0, missing = 0;

  for (const email of emails) {
    const u = find.get(email) as { id: number; email: string; name: string } | undefined;
    if (!u) {
      console.error(`  ✗ ${email} — אין חשבון כזה. (המשתמש צריך להירשם קודם; הסקריפט לא יוצר חשבונות.)`);
      missing++;
      continue;
    }
    const before = isUnlimited(u.id);
    const after = setUnlimited(u.id, !off);
    changed += before === after ? 0 : 1;
    console.log(
      `  ${after ? "∞" : "•"} ${u.email} (#${u.id}, ${u.name}) — ` +
      (before === after
        ? `כבר היה ${after ? "ללא הגבלה" : "רגיל"}, ללא שינוי`
        : after ? "הוגדר ללא הגבלה" : "הוחזר למודל הקרדיטים הרגיל")
    );
  }

  console.log(`\nset-unlimited: ${changed} שונו, ${emails.length - changed - missing} כבר היו במצב המבוקש, ${missing} לא נמצאו`);
  if (missing) process.exitCode = 1;
}

main();
