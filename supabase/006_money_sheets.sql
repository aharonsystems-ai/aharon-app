-- 006: debts "owed to me" + expenses kinds, mirrored from the owner's money sheets (עו"ש file + עלויות פרויקטים)
alter table public.debts add column if not exists dir text default 'אני חייב';
alter table public.debts add column if not exists orig numeric;
alter table public.debts add column if not exists sheet_key text;
alter table public.expenses add column if not exists kind text;
alter table public.expenses add column if not exists qty numeric;
alter table public.expenses add column if not exists unit_price numeric;
alter table public.expenses add column if not exists sheet_key text;
create unique index if not exists debts_sheet_key on public.debts(sheet_key);
create unique index if not exists expenses_sheet_key on public.expenses(sheet_key);
update public.debts set dir = 'אני חייב' where dir is null;
-- the old one-off copies are replaced by the sheet sync
delete from public.expenses where source in ('גיליון עו״ש', 'גיליון אהרן מערכות 2026') and sheet_key is null;
delete from public.debts where source = 'גיליון עו״ש' and sheet_key is null;
