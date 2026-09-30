# The tax authority's deal register (via over.org.il)

`lib/mekarkein.ts` · `lib/mekarkeinPromote.ts` · `lib/mekarkeinDb.ts` ·
`scripts/import-mekarkein-deals.ts` · `scripts/match-mekarkein.ts` · `scripts/promote-mekarkein.ts` ·
collectors `mekarkein-deals`, `mekarkein-match`, `mekarkein-promote`.

## What it is

over.org.il (גרסאות לעם, MIT code at github.com/zomer-g/ckan-version-tracker)
publishes the register of nadlan.taxes.gov.il as one table: 3.84M deals since
1998 with gush, helka, sub-parcel, date, sale value, declared consideration,
deal type, share sold, area, rooms and year built. It has **no address and no
floor**. Their own check against nadlan.gov.il: 140 of 145 sales match on date
and amount (120 to the shekel, 20 rounded to the thousand).

## Why merge into ours, not replace ours

Replacing our deals would lose address, floor, developer projects, coordinates
and all the cleaning. So the register goes in three ways, each stricter than the
last:

1. **Parcel for the deals we hold** (match): every deal since 1998 can learn its
   gush-helka-sub, and from it the address of newer deals in the same flat or
   parcel. That is the route to an address for the ~370k deals before 2021.
2. **New deals** (promote): a register row that is a whole apartment and that no
   deal of ours reports becomes a deal of ours, source `mekarkein`. This is what
   closes the freshness gap. On 28.9.2026 the register held deals to 17.9.2026
   (8,167 in June, 4,420 in July, 1,357 in August) while our newest was 13.8,
   because the only other source of new deals is a run from the Mac.
3. **Address for those new deals**: from our deals in the same flat or parcel,
   else from over.org.il's parcel↔address table (נדל״ן לעם, 494k addresses tied
   to a parcel by point-in-polygon), one parcel per call.

What the 3.84M rows are, by nature: 2.18M "דירה בבית קומות", ~250k houses and
cottages, ~35k garden and ~8k roof flats; the rest is land, shares of land
("מגורים", "ד. מגורים", median ₪230k–₪500k), commerce and offices. Many
apartment rows are a share of a sale (portion < 1). Only whole apartments are
promoted.

Measured on 28.9 against the local sample (Tel Aviv, 2026 rows only): 2,787
register rows → 912 not a whole apartment → 1,875 promoted. With 300 parcel
lookups, 492 got a street and 336 a street and house; in production most
parcels already have donors among our own deals. The pipeline then excluded 271
as price anomalies and 68 as double reports, like any other row.

## How it is used

1. `import-mekarkein-deals.ts` loads the register into the side table
   `mekarkein_deals` (never `nadlan_transactions`). First run: one streamed
   download of ~0.7GB, inside the publisher's 2GB/day per-IP budget. After that:
   only rows first seen since the last run.
2. `match-mekarkein.ts` gives our deals the register's parcel, only when exactly
   one register row matches (whole-asset rows only; exact amount, then rounded to
   the thousand, then our known +1 day date shift). It never overwrites a parcel
   we hold; those rows are the accuracy control. A city whose contradiction rate
   is above 2% (with at least 50 control rows) is not written.
3. The same script fills street and house for deals with a parcel and no
   street, when every deal in the same flat (or, failing that, the same parcel)
   agrees. Otherwise the deal is left alone.

Attribution wherever these rows are used:
"עסקאות נדל"ן — רשות המסים (מיסוי מקרקעין), דרך גרסאות לעם (over.org.il)".

## Turning it on

1. Email the publisher (draft below). Their API docs and 429 message ask bulk
   users to get in touch, and the repository states no data licence.
2. On the server, from /opt/karnaf, first load by hand and measure one city:
   ```
   docker compose exec -T app npx tsx scripts/import-mekarkein-deals.ts
   docker compose exec -T app npx tsx scripts/match-mekarkein.ts --city "חולון" --dry-run
   docker compose exec -T app npx tsx scripts/promote-mekarkein.ts --city "חולון" --dry-run
   ```
   Read the lines: matched share and contradictions (expect ≥85% and <2%); then
   how many rows are new, and how many of those get an address.
3. Write Holon, check the city page and a building page, then all cities:
   ```
   docker compose exec -T app npx tsx scripts/match-mekarkein.ts --city "חולון"
   docker compose exec -T app npx tsx scripts/promote-mekarkein.ts --city "חולון"
   docker compose exec -T app npx tsx scripts/pipeline.ts
   ```
4. In `.env.production`: `KARNAF_MEKARKEIN_ENABLED=1` keeps the register and the
   parcels current every night; `KARNAF_MEKARKEIN_PROMOTE=1` also adds the new
   deals (2,000 parcel lookups a night, newest first, cached in
   `over_parcel_cache`).
   `KARNAF_MEKARKEIN_PROMOTE_SINCE=YYYY-MM-DD` limits the promotion to deals
   from that date (stage 2a); without it every year is promoted (stage 2b).
   Both are set on `deploy/karnaf-collect.service`, so the switch is in git.

To undo the promotion entirely:
`DELETE FROM nadlan_transactions WHERE source = 'mekarkein'`, then the pipeline.

## Draft email to the publisher

> שלום גיא,
>
> אני מפעיל את קרנף אנליסט (analyst.karnafnadlan.com), אתר מחקר לשוק הדיור
> שמבוסס על עסקאות אמת. ראיתי את פרסום מאגר העסקאות של מיסוי מקרקעין ואת
> נדל״ן לעם ב-over.org.il, ואני רוצה להשתמש בהם כדי:
> 1. להשלים גוש-חלקה לעסקאות שכבר יש לנו, ובעיקר לשייך כתובת לעסקאות שלפני 2021;
> 2. להוסיף עסקאות דירה שלמות שעוד לא הגיעו אלינו ממקור אחר;
> 3. לתת לעסקאות האלה כתובת לפי טבלת החלקות-כתובות של נדל״ן לעם.
>
> התכנון: הורדה מלאה אחת של `download.csv` של מאגר העסקאות (בערך 0.7GB), ואחר
> כך עדכון יומי של השורות החדשות בלבד לפי `first_seen`, כמה MB ביום. לכתובות:
> עד כ-2,000 קריאות בלילה ל-`/api/nadlan/parcel/{gush}/{helka}`, בקצב של כ-2
> בשנייה, עם שמירה אצלנו כדי שכל חלקה תישאל פעם אחת. אם נוח לכם יותר שנמשוך את
> `over_re_addresses` בשאילתה אחת דרך `/api/tables/export.csv` (שם נדרשת הזדהות),
> נשמח לגישה כזו, וזה יחסוך לכם את הקריאות הבודדות.
>
> נציין את המקור בכל מקום שבו הנתונים מוצגים, בנוסח: "עסקאות נדל״ן — רשות המסים
> (מיסוי מקרקעין), דרך גרסאות לעם (over.org.il)".
>
> האם זה מתאים לכם? אם יש דרך שעדיפה עליכם, או תנאי שימוש שכדאי שנכיר, אשמח לשמוע.
>
> תודה על העבודה,
> [שם]
