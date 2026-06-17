# Digital Soul — Phase 1 (בוט WhatsApp + מסד נתונים)

המדריך הזה כתוב בשבילך, בלי הנחות על ידע טכני. בצע את הצעדים **בדיוק לפי הסדר**.

הקוד כולו כתוב ומוכן בתיקייה הזו (`src/`). מה שנשאר הוא: לפתוח 3 חשבונות חינמיים, להעתיק כמה "מפתחות" לקובץ אחד, ולהריץ פקודה אחת.

---

## שלב 1 — Supabase (מסד הנתונים)

1. גש ל-https://supabase.com ולחץ "Start your project" → התחבר עם Google/GitHub.
2. לחץ "New project". תן שם (למשל `digital-soul`), בחר סיסמה למסד הנתונים (שמור אותה בצד), ולחץ "Create new project". המתן ~2 דקות שהפרויקט יוקם.
3. בתפריט השמאלי לחץ על אייקון **SQL Editor** → **New query**.
4. פתח את הקובץ [`supabase/schema.sql`](supabase/schema.sql) שנמצא בתיקייה הזו, העתק את כל התוכן, הדבק בעורך ה-SQL, ולחץ **Run**.
   - זה יוצר את שתי הטבלאות שהבוט צריך.
5. בתפריט השמאלי לחץ על **Project Settings** (גלגל שיניים) → **API**.
   - העתק את **Project URL** — זה ה-`SUPABASE_URL`.
   - העתק את **service_role key** (לא ה-anon key!) — זה ה-`SUPABASE_SERVICE_ROLE_KEY`.

## שלב 2 — Anthropic (Claude API) — דילגת על זה אם יש לך כבר מפתח

1. גש ל-https://console.anthropic.com → **API Keys** → **Create Key**.
2. העתק את המפתח (מתחיל ב-`sk-ant-`) — זה ה-`ANTHROPIC_API_KEY`.

## שלב 3 — Twilio WhatsApp Sandbox (חינמי לבדיקות)

1. גש ל-https://www.twilio.com/try-twilio → הירשם (חינם, כרטיס אשראי לא נדרש לבדיקות בסנדבוקס).
2. בלוח הבקרה (Console) חפש **Account SID** ו-**Auth Token** — מופיעים בעמוד הבית. העתק אותם — אלו `TWILIO_ACCOUNT_SID` ו-`TWILIO_AUTH_TOKEN`.
3. בתפריט השמאלי: **Messaging → Try it out → Send a WhatsApp message**.
   - תראה הוראה כמו: *"send a WhatsApp message to +1 415 523 8886 with the code join \<word-word\>"* — שלח את ההודעה הזו מהוואטסאפ שלך בדיוק כמו שכתוב. זה "מצטרף" את המספר שלך לסנדבוקס לבדיקות.
   - מספר ה-Sandbox (`+14155238886`) הוא ה-`TWILIO_WHATSAPP_NUMBER` (בפורמט `whatsapp:+14155238886`).

## שלב 4 — מילוי קובץ ה-.env

1. בתיקיית הפרויקט, צור עותק של `.env.example` בשם `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
2. פתח את `.env` בעורך טקסט (Notepad מספיק) והדבק את כל הערכים שאספת בשלבים 1-3.

## שלב 5 — חיבור ה-Webhook (כדי שטוויליו ידע לאן לשלוח הודעות)

הבעיה: השרת שלך רץ על המחשב שלך, וטוויליו צריך כתובת ציבורית באינטרנט כדי לדבר איתו. שתי אפשרויות:

**אפשרות א' — לבדיקה מהירה (ngrok), בלי לפרוס לאינטרנט:**
1. הורד והתקן ngrok: https://ngrok.com/download
2. הרץ את השרת שלנו (פקודה בשלב 6).
3. בטרמינל נפרד: `ngrok http 3000`
4. ngrok ייתן לך כתובת כמו `https://xxxx.ngrok-free.app` — זו הכתובת הציבורית הזמנית.
5. ב-Twilio Console: **Messaging → Try it out → Sandbox settings** → בשדה "WHEN A MESSAGE COMES IN" הדבק:
   `https://xxxx.ngrok-free.app/webhook/whatsapp` ולחץ Save.

**אפשרות ב' — פריסה קבועה (מומלץ כשתרצה לעבור לבדיקות אמיתיות):**
פריסה לשירות כמו Railway.app או Render.com (חינמי לפרויקטים קטנים) — אם תרצה, אני אדריך אותך בזה כשנגיע לשלב הזה.

## שלב 6 — הרצה

```powershell
npm install
npm start
```

אם הכל תקין תראה: `Digital Soul server listening on port 3000`.

עכשיו שלח הודעת WhatsApp למספר הסנדבוקס של Twilio (אותו שצירפת בשלב 3) — ה"ישות" אמורה לענות לך בהתאם לאופי שהוגדר לה!

---

## מה כל קובץ עושה (לידיעתך, לא צריך לגעת)

- [`supabase/schema.sql`](supabase/schema.sql) — מבנה הטבלאות במסד הנתונים.
- [`src/supabase.js`](src/supabase.js) — שכבת גישה למסד הנתונים.
- [`src/claude.js`](src/claude.js) — שולח את מצב הישות + היסטוריית שיחה ל-Claude, ומקבל בחזרה תשובה מובנית (טקסט + פעולת טיפול + שינוי מצב).
- [`src/actions.js`](src/actions.js) — מתרגם פעולה (האכלה/ניקוי/משחק/שינה) לשינוי בפועל בסטטיסטיקות.
- [`src/twilio.js`](src/twilio.js) — שליחת הודעות WhatsApp.
- [`src/server.js`](src/server.js) — השרת הראשי: מקבל הודעות נכנסות (Webhook), מפעיל את כל הזרימה.
- [`src/decay.js`](src/decay.js) — "התדרדרות" יומית של הסטטיסטיקות + הודעה יזומה אם הישות "מתגעגעת".

## מה הלאה (Phase 2-4, לא כלול כאן עדיין)

קול (ElevenLabs), מדיה/GIF, אפליקציית FlutterFlow, והתאמה חברתית — נבנה אותם בשלבים הבאים, אחרי שה-MVP הזה יעבוד ויוודא שהקונספט תקין.
