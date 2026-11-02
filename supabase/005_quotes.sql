-- Stage 2: quote follow-ups (already run in the SQL editor on 2026-11-01)
alter table public.morning_docs add column if not exists client_phone text;
alter table public.morning_docs add column if not exists client_email text;

create table if not exists public.quote_followups (
  doc_id       text primary key,          -- morning_docs.id
  status       text not null default 'פתוחה',  -- פתוחה / בטיפול / זכינו / הפסדנו / לא רלוונטי
  next_date    date,
  last_contact timestamptz,
  contacts     int not null default 0,
  phone        text,
  notes        text,
  job_id       uuid,
  updated_at   timestamptz default now()
);
alter table public.quote_followups enable row level security;
drop policy if exists owner_all on public.quote_followups;
create policy owner_all on public.quote_followups for all using (public.is_owner()) with check (public.is_owner());

-- Project <-> quote <-> job links (run 2026-11-02)
alter table public.projects add column if not exists quote_doc_id text;
alter table public.projects add column if not exists job_id uuid;
alter table public.jobs add column if not exists project_id uuid;

-- Recorder (NVR/DVR) details per job (run 2026-11-02)
alter table public.jobs add column if not exists nvr_model text;
alter table public.jobs add column if not exists nvr_serial text;
alter table public.jobs add column if not exists nvr_user text;
alter table public.jobs add column if not exists nvr_pass text;

-- Times + project date for the Google Calendar sync (run 2026-11-02)
alter table public.tasks add column if not exists time text;
alter table public.jobs add column if not exists time text;
alter table public.projects add column if not exists date date;
alter table public.projects add column if not exists time text;

-- Stock sku + recorder code/IP/QR (run 2026-11-02)
alter table public.stock add column if not exists sku text;
alter table public.jobs add column if not exists nvr_code text;
alter table public.jobs add column if not exists nvr_ip text;
alter table public.jobs add column if not exists nvr_qr text;
