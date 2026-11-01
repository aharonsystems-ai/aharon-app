-- אהרן מערכות – מסד נתונים לאפליקציית הניהול
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.is_owner() returns boolean
language sql stable as $$ select coalesce(auth.jwt()->>'email','') = 'aharonsystems@gmail.com' $$;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  client text not null, phone text, place text, address text, work text,
  date date, price numeric, cost numeric, profit numeric,
  paid text default 'לא ידוע', paid_amount numeric, receipt text, notes text, source text,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists public.stock (
  id uuid primary key default gen_random_uuid(),
  name text not null, qty numeric default 0, min_qty numeric default 0, unit_cost numeric,
  supplier text, notes text, created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null, client text, date date, done text default 'פתוח', notes text,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  name text not null, cat text, amount numeric, due date, monthly numeric, paid text default 'פתוח', notes text, source text,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date, vendor text, cat text, amount numeric, vat numeric, for_job text, receipt text, notes text, source text,
  created_at timestamptz default now(), updated_at timestamptz default now());

-- נתונים שמגיעים מ-Morning (קריאה בלבד באפליקציה)
create table if not exists public.morning_docs (
  id text primary key, number text, type int, type_name text, status int, status_name text,
  doc_date date, client text, description text, amount numeric, currency text, url text,
  synced_at timestamptz default now());
create table if not exists public.morning_expenses (
  id text primary key, date date, supplier text, number text, description text, amount numeric, vat numeric,
  synced_at timestamptz default now());
create table if not exists public.sync_log (
  id bigint generated always as identity primary key, at timestamptz default now(), ok boolean, message text);

do $$ declare t text; begin
  foreach t in array array['jobs','stock','tasks','debts','expenses','morning_docs','morning_expenses','sync_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;
