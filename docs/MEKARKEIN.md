# The tax authority's deal register (via over.org.il)

`lib/mekarkein.ts` · `lib/mekarkeinDb.ts` · `scripts/import-mekarkein-deals.ts` ·
`scripts/match-mekarkein.ts` · collectors `mekarkein-deals`, `mekarkein-match`.

## What it is

over.org.il (גרסאות לעם, MIT code at github.com/zomer-g/ckan-version-tracker)
publishes the register of nadlan.taxes.gov.il as one table: 3.84M deals since
1998 with gush, helka, sub-parcel, date, sale value, declared consideration,
deal type, share sold, area, rooms and year built. It has **no address and no
floor**. Their own check against nadlan.gov.il: 140 of 145 sales match on date
and amount (120 to the shekel, 20 rounded to the thousand).

## Why complement, not replace

Replacing our deals would lose address, floor, developer projects, coordinates
and all the cleaning. What the register adds is the **parcel for every deal
since 1998**. Our deals since 9/2021 already tie parcels to street and house, so
an older deal that learns its parcel inherits the address of the newer deals in
the same flat or parcel. That is the only route to an address for the ~370k
deals before 2021.

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
2. On the server, first load by hand and measure one city:
   ```
   docker compose exec -T app npx tsx scripts/import-mekarkein-deals.ts
   docker compose exec -T app npx tsx scripts/match-mekarkein.ts --city "חולון" --dry-run
   ```
   Read the line: matched share, control (confirmed vs contradicting), new
   parcels, addresses. Expect ≥85% matched on recent deals and <2% contradictions.
3. Write Holon, check a building page, then all cities:
   ```
   docker compose exec -T app npx tsx scripts/match-mekarkein.ts --city "חולון"
   docker compose exec -T app npx tsx scripts/match-mekarkein.ts
   ```
4. Add `KARNAF_MEKARKEIN_ENABLED=1` to `.env.production` so the nightly
   collectors keep it current.

## Draft email to the publisher

> שלום גיא,
>
> אני מפעיל את קרנף אנליסט (analyst.karnafnadlan.com), אתר מחקר לשוק הדיור
> שמבוסס על עסקאות אמת. ראיתי את פרסום מאגר העסקאות של מיסוי מקרקעין
> ב-over.org.il, ואני רוצה להשתמש בו כדי להשלים גוש-חלקה ושנת בנייה לעסקאות
> שכבר יש לנו, ובמיוחד כדי לשייך כתובת לעסקאות שלפני 2021.
>
> התכנון: הורדה מלאה אחת של `download.csv` (בערך 0.7GB), ואחר כך עדכון יומי
> של השורות החדשות בלבד לפי `first_seen`, כמה MB ביום. נציין את המקור בכל
> מקום שבו הנתונים מוצגים, בנוסח שלכם.
>
> האם זה מתאים לכם? אם יש דרך שעדיפה עליכם, או תנאי שימוש שכדאי שנכיר,
> אשמח לשמוע.
>
> תודה על העבודה,
> [שם]
