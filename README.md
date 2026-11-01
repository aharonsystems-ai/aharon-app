# אהרן מערכות · אפליקציית ניהול

אפליקציית ניהול פרטית (PWA) לאייפון: עבודות ולקוחות, מלאי, משימות, חובות, הוצאות, וחשבוניות והצעות מחיר מ-Morning.

- `index.html` – האפליקציה. הנתונים ב-Supabase (פרויקט aharon-app), מוגנים ב-RLS: רק aharonsystems@gmail.com קורא וכותב.
- `supabase/schema.sql` – טבלאות והרשאות.
- `supabase/morning-sync.ts` – פונקציה שמושכת מ-Morning (קריאה בלבד). רצה כל שעה (pg_cron). המפתח של Morning שמור ב-Secrets של Supabase.
- המפתח שבקוד הוא publishable key – מותר להיות גלוי בדפדפן.
