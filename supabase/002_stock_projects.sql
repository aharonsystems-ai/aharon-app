-- מלאי: ברקוד, קטגוריה, מחיר מכירה, קישור לפריט ב-Morning
alter table public.stock add column if not exists barcode text;
alter table public.stock add column if not exists category text;
alter table public.stock add column if not exists sell_price numeric;
alter table public.stock add column if not exists brand text;
alter table public.stock add column if not exists morning_item_id text;
create unique index if not exists stock_morning_item on public.stock(morning_item_id) where morning_item_id is not null;
create index if not exists stock_barcode on public.stock(barcode);

-- פרויקטים עם תוכנית מהנדס
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null, client text, address text, status text default 'תכנון', notes text,
  plan_path text,               -- path in storage bucket "plans"
  points jsonb default '[]',    -- [{id,type,x,y,label}] x,y as 0..1 of the image
  created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.projects enable row level security;
drop policy if exists owner_all on public.projects;
create policy owner_all on public.projects for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- אחסון תמונות תוכניות (פרטי)
insert into storage.buckets (id, name, public) values ('plans','plans', false) on conflict (id) do nothing;
drop policy if exists plans_owner on storage.objects;
create policy plans_owner on storage.objects for all to authenticated
  using (bucket_id = 'plans' and public.is_owner()) with check (bucket_id = 'plans' and public.is_owner());

-- קטלוג בסיסי בעברית (כמות 0, למילוי)
insert into public.stock (name, category, qty, min_qty, notes)
select v.name, v.category, 0, v.min_qty, 'קטלוג בסיסי' from (values
 ('מצלמת כיפה IP 4MP','מצלמות',4),('מצלמת צינור IP 4MP','מצלמות',4),('מצלמת טורט IP 4MP','מצלמות',4),
 ('מצלמת כיפה IP 8MP (4K)','מצלמות',2),('מצלמת PTZ ממונעת','מצלמות',0),('מצלמת WiFi','מצלמות',2),('מצלמה סולארית 4G','מצלמות',0),
 ('NVR 4 ערוצים PoE','מקליטים',1),('NVR 8 ערוצים PoE','מקליטים',1),('NVR 16 ערוצים','מקליטים',1),('NVR 32 ערוצים','מקליטים',0),
 ('דיסק קשיח 2TB','מקליטים',1),('דיסק קשיח 4TB','מקליטים',1),('דיסק קשיח 8TB','מקליטים',0),
 ('סוויץ׳ PoE 8 פורטים','תקשורת',1),('סוויץ׳ PoE 16 פורטים','תקשורת',0),('ראוטר','תקשורת',0),('נקודת גישה WiFi (Access Point)','תקשורת',1),
 ('ארון תקשורת 6U','תקשורת',0),('פאץ׳ פאנל 24','תקשורת',0),('כבל CAT6 (גליל 305 מ׳)','כבלים',1),('כבל CAT7 (מטר)','כבלים',0),
 ('קיסטון CAT6','תקשורת',10),('מחבר RJ45','תקשורת',50),('קופסת חיבורים למצלמה','אביזרים',6),('זרוע מרחיקה למצלמה','אביזרים',2),
 ('תעלה (2 מ׳)','אביזרים',10),('ספק כוח 12V','אביזרים',2),('UPS','אביזרים',0),
 ('רכזת אזעקה','אזעקה',0),('גלאי נפח','אזעקה',2),('מגע מגנטי לדלת','אזעקה',4),('סירנה חיצונית','אזעקה',1),('לוח מקשים לאזעקה','אזעקה',0),
 ('אינטרקום וידאו – פאנל כניסה','אינטרקום',0),('אינטרקום וידאו – מסך פנימי','אינטרקום',0),('מנעול אלקטרומגנטי','בקרת כניסה',0),('קורא כרטיסים / תג','בקרת כניסה',0),
 ('רמקול תקרה','אודיו',4),('רמקול קיר','אודיו',2),('מגבר כריזה','אודיו',0),('מגבר קליטה סלולרי','מגברי קליטה',0)
) as v(name, category, min_qty)
where not exists (select 1 from public.stock s where s.name = v.name);

select (select count(*) from stock) stock_items, (select count(*) from storage.buckets where id='plans') bucket;
