-- חשבוניות ספקים: נקלטות אוטומטית מהג'ימייל (Apps Script) או מהעלאה ידנית באפליקציה.
-- עוברים עליהן באפליקציה, שולחים ל-Morning, ושולחים לרו"ח במרוכז פעם בחודש.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  msg_id text unique,                 -- gmail message id + ":" + attachment index (null for manual uploads)
  source text default 'gmail',        -- gmail / ידני
  received_at timestamptz, from_email text, from_name text, subject text,
  kind text default 'expense',        -- expense / income / other (AI)
  doc_type text, supplier text, supplier_id text, doc_number text, doc_date date,
  amount numeric, vat numeric, description text,
  month text,                         -- YYYY-MM the invoice is reported in
  file_path text, file_name text, mime text,
  status text default 'לבדיקה',       -- לבדיקה / מאושר / לא רלוונטי
  morning_state text, morning_at timestamptz, morning_err text,
  sent_at timestamptz, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists invoices_month on public.invoices(month);

create table if not exists public.invoice_sends (
  id uuid primary key default gen_random_uuid(),
  month text not null, to_email text not null,
  status text default 'ממתין',        -- ממתין / נשלח / שגיאה
  count int, total numeric, error text,
  requested_at timestamptz default now(), sent_at timestamptz);

create table if not exists public.app_settings (key text primary key, value text, updated_at timestamptz default now());

do $$ declare t text; begin
  foreach t in array array['invoices','invoice_sends','app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

insert into storage.buckets (id, name, public) values ('invoices','invoices', false) on conflict (id) do nothing;
drop policy if exists invoices_owner on storage.objects;
create policy invoices_owner on storage.objects for all to authenticated
  using (bucket_id = 'invoices' and public.is_owner()) with check (bucket_id = 'invoices' and public.is_owner());

select (select count(*) from public.invoices) invoices, (select count(*) from storage.buckets where id='invoices') bucket;
