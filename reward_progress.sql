create table if not exists reward_progress (
  id bigint generated always as identity primary key,
  reward_name text not null unique,
  reward_type text,
  progress_status text not null default '设计中'
    check (progress_status in ('设计中','打样中','生产中','发放中','已完结')),
  progress_note text,
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

alter table reward_progress enable row level security;

create policy "public read reward_progress"
on reward_progress for select
using (true);

create policy "admin write reward_progress"
on reward_progress for all
to authenticated
using (true)
with check (true);
