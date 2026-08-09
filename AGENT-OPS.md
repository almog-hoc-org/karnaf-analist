# גישת סוכן AI לתפעול קרנף אנליסט

מדריך לחיבור סוכן AI (Claude או אחר) לתפעול השוטף: ניהול משתמשים, ניטור,
זיהוי באגים וטיפול בפניות. הסוכן מקבל **טוקן API ייעודי** — לא את סיסמת
האדמין האנושית — כך שאפשר לבטל/להחליף אותו בכל רגע בלי לגעת בגישה שלך.

## הפעלה (חד-פעמי)

1. ייצר טוקן חזק: `openssl rand -hex 32` (או כל מחרוזת אקראית ארוכה).
2. בשרת, ב-`/opt/karnaf/.env.production` הוסף:
   ```
   ADMIN_API_TOKEN=הטוקן-שיצרת
   ```
3. ‏`cd /opt/karnaf && bash scripts/deploy.sh`
4. מסור לסוכן את הטוקן ואת המדריך הזה. בלי המשתנה — נתיב ה-API סגור לחלוטין
   (fail-closed); מחיקת המשתנה + deploy מבטלת את הגישה מיידית.

## אימות

כל בקשה נושאת: `Authorization: Bearer <ADMIN_API_TOKEN>`

בסיס: `https://analyst.karnafnadlan.com`

## נקודות הקצה

### ניטור ובריאות
| Method | Path | מה מקבלים |
|---|---|---|
| GET | `/api/health` | ‏liveness פשוט (פתוח, בלי טוקן) |
| GET | `/api/status` | טריות דאטה: ריצות pipeline/איסוף אחרונות, בעיות, ספירות (פתוח) |

### משתמשים — `/api/admin/users`
| קריאה | גוף | תוצאה |
|---|---|---|
| GET | — | `{users:[{id,email,name,phone,mailing_consent,google_id,created_at,credits,deals,last_seen}]}` |
| POST | `{"action":"create","email","name","password","phone?"}` | יצירת משתמש (+בונוס הרשמה) |
| POST | `{"action":"delete","userId":N}` | מחיקה מלאה (בלתי הפיכה: עסקאות, קרדיטים, סשנים) |
| POST | `{"action":"reset_password","userId":N}` | `{tempPassword}` — מוצג פעם אחת; כל הסשנים מנותקים |
| POST | `{"action":"adjust_credits","userId":N,"credits":±N,"note":"..."}` | זיכוי/חיוב קרדיטים (נרשם ב-ledger) |
| POST | `{"action":"set_consent","userId":N,"consent":true/false}` | עדכון הסכמת דיוור |

### דיוור תפוצה — `/api/admin/broadcast`
| קריאה | גוף | תוצאה |
|---|---|---|
| GET | — | `{configured, history:[...]}` |
| POST | `{"subject","body"}` | שולח ב-Resend לכל מסכימי הדיוור; מחזיר `{sent,recipients,failed,errors}` |

### משוב משתמשים
| קריאה | Path | מה |
|---|---|---|
| POST | `/api/admin/feedback-approve` ‏`{"id":N}` | אישור משוב (מזכה את הכותב בבונוס, חד-פעמי) |

### סנכרונים
| קריאה | Path | מה |
|---|---|---|
| POST | `/api/admin/sync-mailing` ‏`{"target":"ravmesser"\|"crm"}` | הרצת סנכרון; מחזיר דוח |
| GET | `/api/admin/sync-mailing?export=csv` | ‏CSV מלא של המשתמשים |

## משימות תפעול נפוצות לסוכן

- **"משתמש שכח סיסמה"** → ‏GET users למצוא לפי אימייל → ‏reset_password → למסור למשתמש את הזמנית.
- **"משתמש מתלונן שנעלמו לו קרדיטים"** → ‏GET users (יתרה) → אם מוצדק: adjust_credits עם note מנומק.
- **ניטור בוקר** → ‏GET ‏/api/status — אם `ok:false` או problems לא ריק, לדווח למפעיל עם הפירוט.
- **הודעת גרסה** → ‏POST broadcast עם subject+body (טקסט חופשי; שורה ריקה = פסקה).
- **משוב חדש** → מופיע ב-GET users? לא — משוב נצפה בפאנל; אישור דרך feedback-approve לפי id.

## גבולות

- הטוקן מקנה גישת תפעול רחבה אבל **לא** גישת SSH לשרת ולא שינוי קוד.
- מחיקת משתמש היא בלתי הפיכה — על הסוכן לאשר עם המפעיל לפני מחיקה.
- שינויי חוקי מערכת (מחירי קרדיטים וכו') נעשים בפאנל האדמין האנושי — לא נחשפו ל-API בכוונה.
