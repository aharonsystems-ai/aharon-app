-- photos on projects and tasks; jobs that wait for a combined invoice
alter table public.projects add column if not exists photos jsonb default '[]';
alter table public.tasks add column if not exists photos jsonb default '[]';
alter table public.jobs add column if not exists bill_later boolean default false;
select count(*) from public.jobs;
