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

## שלב 3 · כניסה עם גוגל (15 דקות — לפי הממשק החדש של גוגל, 2025+)

> גוגל ארגנו מחדש את המסכים האלה ("Google Auth Platform"); מדריכים ישנים
> מתארים תפריטים שכבר לא קיימים. הקישורים כאן ישירים ומדלגים על התפריטים.

### 3.1 יצירת פרויקט (2 דקות)
1. פתח את הקישור הישיר: https://console.cloud.google.com/projectcreate
   (התחבר עם חשבון הגוגל העסקי אם צריך; אם מופיע מסך תנאים — אשר.)
2. ‏Project name: `karnaf-analist` → כפתור **Create**.
3. המתן לחלונית "Project created" (פעמון למעלה) ולחץ בה **Select project** —
   או ודא שלמעלה משמאל כתוב karnaf-analist בבורר הפרויקטים.

### 3.2 אשף ההגדרה (5 דקות)
1. פתח: https://console.cloud.google.com/auth/overview
2. לחץ על הכפתור הכחול **Get started**. נפתח אשף של 4 צעדים באותו עמוד:
   - **App Information** — ‏App name: `קרנף אנליסט` · ‏User support email: בחר את המייל שלך מהרשימה → Next
   - **Audience** — בחר **External** (חשוב! Internal לא יעבוד לגולשים) → Next
   - **Contact Information** — המייל שלך → Next
   - **Finish** — סמן את תיבת ההסכמה → **Continue** → **Create**

### 3.3 יצירת המפתחות (5 דקות)
1. פתח: https://console.cloud.google.com/auth/clients/create
2. ‏Application type: **Web application**
3. ‏Name: `karnaf-analist-web`
4. גלול ל-**Authorized redirect URIs** → לחץ **+ Add URI** → הדבק בדיוק:
   `https://srv1773229.hstgr.cloud/api/auth/google/callback`
5. לחץ **Create**. נפתחת חלונית עם **Client ID** (נגמר ב-apps.googleusercontent.com)
   ו-**Client secret** (מתחיל ב-GOCSPX). העתק את שניהם למקום זמני — ה-secret
   מוצג פעם אחת.

### 3.4 פרסום האפליקציה (דקה)
1. פתח: https://console.cloud.google.com/auth/audience
2. תחת Publishing status לחץ **Publish app** → ‏Confirm.
   (בלי זה רק אתה תוכל להתחבר עם גוגל, אף גולש אחר לא.)

### 3.5 הזנה בשרת (3 דקות)
1. התחבר לשרת (Hostinger → VPS → Browser terminal, או ssh).
2. ‏`nano /opt/karnaf/.env.production` → מצא/הוסף את השורות:
```
GOOGLE_CLIENT_ID=הדבק-את-ה-Client-ID
GOOGLE_CLIENT_SECRET=הדבק-את-ה-Secret
```
3. שמור וצא: ‏Ctrl+O ‏← Enter ‏← Ctrl+X
4. ‏`cd /opt/karnaf && bash scripts/deploy.sh`
5. בדיקה: פתח את עמוד ההתחברות באתר — כפתור "המשך עם Google" הופיע. נסה אותו.

**בעתיד**, כשעוברים ל-analyst.karnafnadlan.com: חוזרים ל-3.3 (עריכת ה-client
הקיים ב-https://console.cloud.google.com/auth/clients) ומוסיפים redirect URI
נוסף עם הדומיין החדש.

---


## שלב 3.5 · חיבור הדומיין analyst.karnafnadlan.com (15 דקות + זמן התפשטות DNS)

### א. רשומת DNS (איפה שהדומיין karnafnadlan.com מנוהל)
1. היכנס לניהול ה-DNS של karnafnadlan.com:
   - אם הדומיין ב-Hostinger: ‏hpanel.hostinger.com ← ‏Domains ← ‏karnafnadlan.com ← ‏DNS / Name Servers
   - אם האתר הראשי ב-Wix והדומיין מנוהל שם: ‏Wix ← הגדרות ← דומיינים ← ‏karnafnadlan.com ← ‏DNS Records
2. הוסף **רשומת A** חדשה:
   - ‏Host/Name: ‏`analyst`
   - ‏Value/Points to: ‏`72.62.7.226`
   - ‏TTL: ברירת המחדל
3. שמור. ההתפשטות לוקחת בין דקות לשעה-שעתיים. בדיקה שהסתיימה:
   ‏https://dnschecker.org ← הקלד `analyst.karnafnadlan.com` ← אמור להראות 72.62.7.226.

### ב. גוגל — להוסיף את הכתובת החדשה (2 דקות, אפשר מיד)
1. פתח: https://console.cloud.google.com/auth/clients ← לחץ על `karnaf-analist-web`
2. תחת Authorized redirect URIs ← **+ Add URI** ← הדבק:
   `https://analyst.karnafnadlan.com/api/auth/google/callback`
3. ‏**Save**. (הכתובת הישנה נשארת — שתיהן עובדות במקביל.)

### ג. השרת (אחרי שה-DNS מתפשט!)
```bash
nano /opt/karnaf/.env.production
```
עדכן/הוסף שלוש שורות:
```
APP_HOST=analyst.karnafnadlan.com
APP_HOST_LEGACY=srv1773229.hstgr.cloud
KARNAF_SITE_URL=https://analyst.karnafnadlan.com
```
שמור (Ctrl+O, Enter, Ctrl+X) ואז:
```bash
cd /opt/karnaf && bash scripts/deploy.sh
```
בפריסה הזו Traefik יבקש אוטומטית תעודת SSL לדומיין החדש מ-Let's Encrypt
(חייב DNS מתפשט — לכן סעיף א קודם!), והכתובת הישנה תהפוך להפניית-קבע (301)
לדומיין החדש, כך ששום קישור ששיתפת לא נשבר.

### ד. אימות
- ‏https://analyst.karnafnadlan.com נפתח עם מנעול תקין (ייתכן שבדקה הראשונה
  התעודה עוד מונפקת — רענן אחרי דקה).
- ‏https://srv1773229.hstgr.cloud מפנה אוטומטית לדומיין החדש.
- כניסת גוגל עובדת בדומיין החדש.
- קישור שיתוף מ"החשבון שלי" מציג עכשיו את הדומיין החדש.

---


## שלב 4 · סנכרון רב מסר (10 דקות)

הקוד מדבר בפורמט ה-API הרשמי של רב מסר (אומת מול ערכת הדוגמאות הרשמית שלהם —
github.com/responder/restapi). צריך רק שני פרטים:

1. **הטוקן (Authorization):**
   - **במערכת החדשה של רב מסר**: הגדרות ← "חיבורים חיצוניים (API)" ← הפעל ← העתק את ה-Token.
     המדריך שלהם: https://kb.responder.co.il/knowledge-base/מסך-הגדרת-חיבורים-חיצוניים-api/
   - **במערכת הישנה אין מסך כזה** — מתקשרים לתמיכה **03-717-7777** (או צ'אט באתר)
     ואומרים: "אני רוצה לקבל Client API למערכת". מנפיקים תוך שיחה.
2. **מזהה הרשימה**: היכנס לרשימת התפוצה במערכת — המספר (למשל 802195) מופיע
   בכתובת הדפדפן של דף הרשימה.
3. בשרת: `nano /opt/karnaf/.env.production` והוסף:
```
RAVMESSER_API_KEY=הטוקן-שקיבלת
RAVMESSER_LIST_ID=מספר-הרשימה
```
   שמור (Ctrl+O, Enter) וצא (Ctrl+X), ואז: `cd /opt/karnaf && bash scripts/deploy.sh`
4. באתר: /admin → "👥 משתמשים ודיוור" → **"סנכרן לרב מסר"**. הדוח מתחת לכפתור
   מציג כמה סונכרנו; שגיאת HTTP? העתק לי אותה כלשונה ואטפל.
5. עד אז (ובכלל): **"הורד CSV"** תמיד עובד — את הקובץ אפשר לייבא ידנית לרב מסר
   (ייבוא אנשי קשר) בלי שום הגדרה.

---

## שלב 5 · סנכרון ל-karnaf-crm (2 דקות — הכתובת כבר ידועה)

אין צורך להיכנס ל-Supabase: מזהה הפרויקט של ה-CRM מתועד בריפו שלו. פשוט:

1. בשרת: `nano /opt/karnaf/.env.production` והוסף את השורה הזו בדיוק:
```
CRM_INTAKE_URL=https://svkzkpgccahwmyflobvn.functions.supabase.co/website-leads-intake
```
2. `cd /opt/karnaf && bash scripts/deploy.sh`
3. באתר: /admin → "משתמשים ודיוור" → **"סנכרן ל-CRM"**.
   נשלחים רק נרשמים שמילאו טלפון (דרישת ה-CRM), עם מקור analyst-signup —
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
