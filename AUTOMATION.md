# Automation — Report Monitor & Email Notifications

This project includes an automatic monitor that polls CBS and the Ministry of Finance Chief Economist for new housing publications, updates the local registry, and emails you when a new report appears.

## What's already built

| Component | File | Status |
|-----------|------|--------|
| Source registry | `lib/sources.ts` | ✅ Ready — 20 sources tracked, each with monitor URL and publication schedule |
| Report monitor | `lib/check-new-reports.ts` | ✅ Ready — polls all sources with `monitorUrl`, detects new publications |
| Email notifier | `lib/notify.ts` | ✅ Ready — Resend-based, falls back to console logging if not configured |
| Deals cache builder | `lib/prefetch-deals.ts` | ✅ Ready — rebuilds deals/comparison cache |
| Source detail pages | `app/sources/[id]/page.tsx` | ✅ Ready — click any source in `/sources` to see its data in our format |
| Schedule predictor | `nextExpectedPublication()` in `lib/sources.ts` | ✅ Ready — shows "next expected" date on `/sources` |

## What you need to do — 3 steps, ~10 minutes

### 1. Sign up for Resend (free, 3,000 emails/month)
1. Go to [resend.com](https://resend.com) and create a free account
2. Generate an API key (Dashboard → API Keys → Create)
3. (Optional, recommended) Verify a sending domain so emails won't go to spam. Without verification, Resend sends from a generic `onboarding@resend.dev`.

### 2. Configure environment variables
Create `.env.local` in the project root:
```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
NOTIFY_TO_EMAIL=you@yourdomain.com
NOTIFY_FROM_EMAIL=notifications@yourdomain.com   # must be verified in Resend
```

If you skip this, the monitor still runs — it just logs to console instead of emailing.

### 3. Schedule the monitor with cron
First, do a one-time **bootstrap run** so the registry knows which reports already exist (otherwise you'll get a flood of "new" emails on the first real run):
```bash
cd "/path/to/project"
npx tsx lib/check-new-reports.ts
```
The first run records everything as the baseline. From then on, only NEW publications trigger notifications.

Then add a cron entry (`crontab -e`):
```cron
# Check for new CBS / MoF reports every hour at minute 7
7 * * * * cd "/full/path/to/my-realestate-project" && /usr/local/bin/npx tsx lib/check-new-reports.ts >> /tmp/reports-monitor.log 2>&1
```

Verify with `crontab -l`. Watch `/tmp/reports-monitor.log` for output.

## How it works — two detection modes

The monitor runs **two complementary checks** every time it executes:

### Mode A — Active scraping
1. Fetches the HTML of each source's `monitorUrl` (CBS press release index, MoF publications)
2. Extracts publication links via regex
3. Dedupes against `data/seen_reports.json`
4. For each NEW link → notification

**Current limitation:** CBS pages are SharePoint SPAs (content loads via JS), and gov.il returns 403 to bots. The scraper finds 0 links on those pages today. To fully solve this, a headless browser (Playwright) would be needed — a much heavier setup. The framework is in place; adding Playwright is a follow-up that requires more dependencies.

### Mode B — Schedule-based overdue alerts (always works)
1. Each source has a `publicationSchedule` (monthly/quarterly/annual) and a known last publication date
2. `nextExpectedPublication()` computes when the next publication should appear
3. If today is past that date and we haven't already alerted → send an "overdue" email saying "X was expected on date Y, manually check {URL}"
4. Each overdue alert fires only once per expected date (no spam)

This means **you'll never miss a report** even if scraping fails — you get a manual-review nudge with the link to check.

### Notification (both modes)
HTML email sent via Resend with:
- Report title (or "X is overdue" for mode B)
- Source name
- Publication date or expected date
- 📄 link to the original page
- 🔗 link to its page in this system (`/sources/[id]`)

## Bootstrap behavior

On the first run, the registry is empty. Rather than sending an email for every existing report (would spam you), the script:
- Records everything as the seen baseline
- Logs `✨ Bootstrap: recorded N existing reports as seen baseline`
- Sends NO emails

From the second run onward, only truly new publications trigger notifications.

## Updating data after a new report

The monitor *detects* new reports but doesn't auto-import their contents (that requires parsing PDFs which is error-prone). When you get an email:
1. Open the report at the link in the email
2. Run an integration script if applicable, e.g.:
   - `npx tsx lib/import-updates.ts` — re-imports from `data/*.json` files
   - `npx tsx lib/prefetch-deals.ts --force` — rebuilds deals cache
3. Or ask Claude to ingest the new report content

## Files & directories

```
data/
  seen_reports.json          # Dedup registry (do not edit manually)
  reports_log.json           # Full log of detected reports
  scattered_city_facts.json  # Imported per-city facts from monitored reports
  deals_cache/               # Per-city deals comparison cache (one JSON per city)
lib/
  sources.ts                 # Source registry & schedule predictor
  check-new-reports.ts       # Cron-runnable monitor
  notify.ts                  # Email sender (Resend)
  prefetch-deals.ts          # Deals cache builder
app/sources/                 # /sources index + /sources/[id] detail pages
```

## Troubleshooting

**No emails arriving?**
- Check `cron.log` (the cron task output) for errors
- Verify `RESEND_API_KEY` is loaded — run the monitor manually and check console
- Check Resend dashboard for delivery status
- If using your own domain in `NOTIFY_FROM_EMAIL`, ensure DNS records (SPF, DKIM, DMARC) are configured per Resend's instructions

**Monitor reports zero new but you know reports exist?**
- The HTML structure of CBS/MoF pages may have changed. Update the regex in `extractCbsReleases` / `extractMofPublications` in `lib/check-new-reports.ts`.
- Or call Claude: "the report monitor stopped detecting CBS reports, please update the extraction logic"

**Reports flooding email?**
- Delete `data/seen_reports.json` to reset, then re-bootstrap
- Or tighten the regex to only match specific subjects (e.g., only `subject=15` for housing)
