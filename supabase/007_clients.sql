-- client card: job kind + client name aliases (same client under different names)
alter table public.jobs add column if not exists kind text;
create table if not exists public.client_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null unique,
  name text not null,
  created_at timestamptz default now());
alter table public.client_aliases enable row level security;
drop policy if exists owner_all on public.client_aliases;
create policy owner_all on public.client_aliases for all to authenticated using (public.is_owner()) with check (public.is_owner());
insert into public.client_aliases(alias,name) values ('מוסדות אור הזוהר הקדוש','ברוך פריד') on conflict (alias) do nothing;
