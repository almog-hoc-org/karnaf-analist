# מדריך השקה — צעד אחר צעד

> נכתב 8.8.2026. כל שלב עומד בפני עצמו; אפשר לעצור אחרי כל אחד.
> **חשוב לדעת: ה-deploy אוטומטי** — כל push ל-branch שב-`.github/workflows` מפעיל
> בנייה ופריסה לשרת. אין כפתור "העלה לאוויר" — האוויר מתעדכן לבד.

---

## שלב 1 · לבדוק מה חי עכשיו (10 דקות, רק דפדפן)

1. פתח חלון גלישה בסתר (Ctrl+Shift+N).
2. גלוש ל-https://srv1773229.hstgr.cloud
3. עבור על הצ'קליסט:
   - [ ] עמוד הבית: הבאדג' אומר "מאגר עסקאות עצמאי · מבוסס נתוני אמת" (לא "מתעדכן יומית")
   - [ ] "מחשבונים" מופיע בתפריט העליון ועובד
   - [ ] עמוד חיפה נפתח חופשי: https://srv1773229.hstgr.cloud/city/חיפה
   - [ ] עיר אחרת (למשל חולון) מציגה מסך הרשמה
   - [ ] הרשמה עם מייל → מקבלים 10 קרדיטים (רואים בפינה למעלה)
   - [ ] פתיחת עיר → היתרה יורדת ל-9 → כניסה חוזרת לאותה עיר חינם
   - [ ] "החשבון שלי" (לחיצה על השם) → יתרה, קישור שיתוף, תנועות
   - [ ] יציאה (logout) עובדת ולא נותנת 404
   - [ ] בטלפון: הכול קריא, טבלאות נגללות הצידה עם עמודה ראשונה קבועה

**אם אתה לא מוכן שהחומה תהיה באוויר:** היכנס ל-/admin → טאב "⚙️ חוקי המערכת"
→ קבוצת "קרדיטים וגישה" → כבה את "חומת הרשמה על עמודי ערים". האתר חוזר
לפתוח-לגמרי מיידית, בלי deploy. מדליקים שוב באותו מקום כשמוכנים.

---

## שלב 2 · בשרת: גיבוי אוטומטי + בדיקת ה-pipeline (20 דקות, טרמינל)

### 2א. להתחבר לשרת
- דרך Hostinger: https://hpanel.hostinger.com → VPS → srv1773229 → כפתור "Browser terminal",
- או מהמק: `ssh root@srv1773229.hstgr.cloud`

### 2ב. לבדוק את שתי ריצות ה-pipeline שנכשלו ב-2.8
```bash
journalctl -u karnaf-pipeline -n 150 --no-pager
```
חפש את השורה עם ✗ — היא אומרת איזה שלב נפל ולמה. ואז ריצה חוזרת מאותו שלב:
```bash
cd /opt/karnaf
docker compose exec -T app npx tsx scripts/pipeline.ts --from=classify
```
(אם נפל בשלב אחר — החלף את `classify` בשם שמופיע בלוג.)
בסוף ודא ירוק: https://srv1773229.hstgr.cloud/api/status

### 2ג. להפעיל את הגיבוי השבועי
1. צור טוקן גיטהאב: https://github.com/settings/tokens → "Generate new token (classic)"
   → שם: `karnaf-backup` → סמן scope בשם **repo** → Generate → העתק (מתחיל ב-ghp_).
2. בשרת:
```bash
mkdir -p /etc/karnaf
echo 'GH_TOKEN=ghp_הטוקן-שהעתקת' > /etc/karnaf/backup.env
chmod 600 /etc/karnaf/backup.env
command -v gh >/dev/null || apt install -y gh
bash /opt/karnaf/deploy/install-timers.sh
```
3. הרצת מבחן מיידית (לא מחכים ליום ראשון):
```bash
systemctl start karnaf-backup.service
journalctl -u karnaf-backup -f        # Ctrl+C ליציאה כשרואים "✓ backup published"
```
4. ודא שנוצר: https://github.com/almog-hoc-org/karnaf-analist/releases — אמור להופיע `data-2026....`

---

## שלב 3 · כניסה עם גוגל (20 דקות)

1. גלוש ל-https://console.cloud.google.com (התחבר עם חשבון הגוגל העסקי).
2. למעלה: בורר הפרויקטים → **New Project** → שם: `karnaf-analist` → Create.
3. תפריט ☰ → **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - App name: `קרנף אנליסט` · Support email: המייל שלך → שמור והמשך עד הסוף (אין צורך ב-scopes מיוחדים).
   - תחת Publishing status לחץ **Publish app** (אחרת רק אתה תוכל להתחבר).
4. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `karnaf-analist-web`
   - Authorized redirect URIs → **Add URI**:
     `https://srv1773229.hstgr.cloud/api/auth/google/callback`
   - Create → העתק את **Client ID** ואת **Client secret**.
5. בשרת:
```bash
nano /opt/karnaf/.env.production
```
   הוסף בסוף (או מלא את השורות הריקות):
```
GOOGLE_CLIENT_ID=מה-שהעתקת.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=מה-שהעתקת
```
   שמור (Ctrl+O, Enter) וצא (Ctrl+X), ואז:
```bash
cd /opt/karnaf && bash scripts/deploy.sh
```
6. בדיקה: עמוד ההתחברות באתר מציג עכשיו כפתור "המשך עם Google" — נסה אותו.
7. **בעתיד**, כשעוברים ל-analyst.karnafnadlan.com — חוזרים לשלב 4 ומוסיפים redirect URI נוסף עם הדומיין החדש.

---

## שלב 4 · סנכרון רב מסר (10 דקות)

1. התחבר לחשבון רב מסר: https://www.responder.co.il
2. מצא את **מפתח ה-API**: הגדרות החשבון → חפש "API" (אם לא מוצאים — צ'אט התמיכה שלהם מנפיק Access Token תוך דקות).
3. מצא את **מזהה הרשימה**: היכנס לרשימת התפוצה הרלוונטית — המספר מופיע בכתובת הדף או בהגדרות הרשימה.
4. בשרת, ב-`/opt/karnaf/.env.production`:
```
RAVMESSER_API_KEY=המפתח
RAVMESSER_LIST_ID=מספר-הרשימה
```
   ואז `cd /opt/karnaf && bash scripts/deploy.sh`
5. באתר: /admin → טאב "👥 משתמשים ודיוור" → כפתור **"סנכרן לרב מסר"**.
   הדוח שמופיע מתחת לכפתור אומר בדיוק כמה סונכרנו וכמה נכשלו.
   ⚠️ אם הריצה הראשונה מחזירה שגיאות HTTP — זה כנראה פורמט ההרשאה של רב מסר
   (יש להם שתי גרסאות API). תגיד לי מה השגיאה ואתקן שורה אחת.
6. בכל מקרה, כפתור **"הורד CSV"** שם תמיד עובד — גיבוי בלי שום הגדרה.

---

## שלב 5 · סנכרון ל-karnaf-crm (5 דקות)

1. גלוש ל-https://supabase.com/dashboard → בחר את פרויקט ה-CRM.
2. **Project Settings → General** → העתק את ה-**Reference ID** (מחרוזת כמו `abcdefghij`).
3. בשרת, ב-`.env.production`:
```
CRM_INTAKE_URL=https://ה-REF-שהעתקת.functions.supabase.co/website-leads-intake
```
   ואז deploy כרגיל.
4. באתר: /admin → "משתמשים ודיוור" → **"סנכרן ל-CRM"**.
   נשלחים רק נרשמים שמילאו טלפון (דרישת ה-CRM), עם מקור `analyst-signup` —
   הם יופיעו כלידים חדשים במערכת ה-CRM שלך.

---

## שלב 6 · הפעלת Clarity — הקלטות גולשים (10 דקות)

1. גלוש ל-https://clarity.microsoft.com → התחבר (אפשר עם חשבון גוגל).
2. **New project** → שם: `קרנף אנליסט` → Website: `https://srv1773229.hstgr.cloud`.
3. אחרי היצירה: **Settings → Setup** → העתק את ה-**Project ID** (מחרוזת קצרה).
4. בשרת, ב-`.env.production`:
```
NEXT_PUBLIC_CLARITY_ID=המזהה
```
   ⚠️ הערך הזה נאפה בזמן build — חובה `bash scripts/deploy.sh` אחרי השינוי, restart לא מספיק.
5. תוך יום-יומיים תראה ב-clarity.microsoft.com: הקלטות מסך של גולשים אמיתיים,
   מפות חום, ואיפה הם נתקעים. (הקוד כבר מוגדר לא להקליט את /deals, /admin ועמודי ההתחברות.)

---

## שלב 7 · סיור באדמין החדש (5 דקות, כדאי)

היכנס ל-/admin ועבור על הטאבים החדשים:
- **⚙️ חוקי המערכת → "קרדיטים וגישה"** — כל מספרי המודל: בונוס הרשמה, מחיר עיר,
  ימי פתיחה, בונוס הפניה, מענק חודשי, עיר הדמו, ומתג החומה. שינוי = מיידי, בלי deploy.
- **👥 משתמשים ודיוור** — מונה נרשמים, כפתורי הסנכרון, ואישור משובים
  (אישור משוב של משתמש רשום מזכה אותו אוטומטית ב-2 קרדיטים, פעם אחת).
- **📈 שימוש** — פעילות 7/30 יום, ובעיקר "חיפושים שלא מצאו כלום" — רשימת
  הביקושים שהגולשים כותבים לך בעצמם.

---

## בהמשך הדרך (לא עכשיו)

| מתי | מה | איך |
|---|---|---|
| כל רבעון | רענון עסקאות מהמק | הצ'קליסט ב-README ("רבעוני, ידני מהמק") |
| ינואר 2027 | העלאת שנת הייחוס ל-2026 | /admin → חוקי המערכת → "שנת ייחוס"; ‏/api/status יתריע לבד |
| כשמוכנים | דומיין analyst.karnafnadlan.com | Hostinger → Domains → karnafnadlan.com → DNS → רשומת A: ‏`analyst` → ‏72.62.7.226; ואז לעדכן בשרת `APP_HOST` ו-`KARNAF_SITE_URL` ב-.env.production + deploy + להוסיף redirect URI בגוגל |
| כשיש דאטת שימוש | מנויים בתשלום (Grow) | התוכנית סגורה — שלב 5 בתוכנית העבודה; לפתוח מסמך הוראת קבע ₪29/₪39 ב-Grow ולהגיד לי |

## אם משהו נשבר

- **החומה עושה בעיות** → ‏/admin → חוקי המערכת → כיבוי "חומת הרשמה" (קליק, מיידי).
- **האתר לא עולה אחרי deploy** → ‏deploy.sh מגבה את ה-DB לפני כל פריסה ובודק health;
  בלוג ה-Actions רואים מה קרה: https://github.com/almog-hoc-org/karnaf-analist/actions
- **שחזור מלא מגיבוי** → ‏`bash scripts/restore-db.sh` (מושך את ה-Release האחרון).
- **מצב הדאטה** → https://srv1773229.hstgr.cloud/api/status — ירוק = הכול רץ.
