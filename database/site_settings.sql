-- Access gate settings for existing Supabase projects.
-- Run this once if the project was created before site_settings existed.

create table if not exists site_settings (
  setting_key text primary key,
  setting_value text not null,
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

insert into site_settings (setting_key, setting_value)
values
  ('access_password_hash', '116070d3ce1fe6fcbf1a3147511bc32442b455a08e571814a490499a09371b5f'),
  ('access_ttl_days', '7')
on conflict (setting_key) do nothing;

alter table site_settings enable row level security;

drop policy if exists "public read site_settings" on site_settings;
create policy "public read site_settings"
on site_settings for select
using (true);

drop policy if exists "admin write site_settings" on site_settings;
create policy "admin write site_settings"
on site_settings for all
to authenticated
using (true)
with check (true);
