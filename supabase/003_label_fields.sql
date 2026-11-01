alter table public.stock add column if not exists model text;
alter table public.stock add column if not exists name_en text;
alter table public.stock add column if not exists serials text;
alter table public.projects add column if not exists manual jsonb default '{}';
