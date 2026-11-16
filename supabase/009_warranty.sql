-- warranty certificate per job + issue invoice in Morning and email it with the warranty from Gmail
alter table public.jobs add column if not exists warranty_no text;
alter table public.jobs add column if not exists warranty_items jsonb default '[]';
alter table public.jobs add column if not exists warranty_path text;
alter table public.jobs add column if not exists client_email text;
alter table public.jobs add column if not exists mail_sent_at timestamptz;
alter table public.jobs add column if not exists mail_to text;
alter table public.jobs add column if not exists invoice_path text;
create unique index if not exists jobs_warranty_no_uq on public.jobs (warranty_no) where warranty_no is not null and warranty_no <> '';

select count(*) filter (where warranty_no is not null) with_warranty, count(*) jobs from public.jobs;
