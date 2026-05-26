create table if not exists visit_logs (
  id bigint generated always as identity primary key,
  visitor_id text not null,
  view_name text not null,
  device_type text,
  user_agent text,
  page_path text,
  created_at timestamp with time zone default now()
);

alter table visit_logs enable row level security;

create policy "public insert visit_logs"
on visit_logs for insert
with check (true);

create policy "admin read visit_logs"
on visit_logs for select
to authenticated
using (true);

create index if not exists visit_logs_created_at_idx
on visit_logs(created_at desc);

create index if not exists visit_logs_view_name_idx
on visit_logs(view_name);

create index if not exists visit_logs_visitor_id_idx
on visit_logs(visitor_id);
