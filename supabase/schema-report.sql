-- check reports (דוח בדיקה ואישור תקינות) made in the app
alter table jobs add column if not exists report_no text;
alter table jobs add column if not exists report_path text;
alter table jobs add column if not exists report_data jsonb;
alter table jobs add column if not exists report_at timestamptz;
