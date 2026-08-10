create table if not exists election_2026_reward_rules (
  id bigint generated always as identity primary key,
  threshold_votes numeric not null default 0 check (threshold_votes >= 0),
  reward_name text not null,
  note text,
  sort_order integer default 0,
  created_at timestamp with time zone default now()
);

create table if not exists election_2026_manual_rewards (
  id bigint generated always as identity primary key,
  user_name text not null,
  reward_name text not null,
  note text,
  fulfilled boolean not null default false,
  fulfilled_date text,
  created_at timestamp with time zone default now()
);

create table if not exists election_2026_reward_status (
  id bigint generated always as identity primary key,
  user_name text not null,
  reward_key text not null,
  fulfilled boolean not null default false,
  fulfilled_date text,
  updated_at timestamp with time zone default now(),
  unique (user_name, reward_key)
);

alter table election_2026_reward_rules
add column if not exists note text;

alter table election_2026_reward_rules
add column if not exists sort_order integer default 0;

alter table election_2026_manual_rewards
add column if not exists note text;

alter table election_2026_manual_rewards
add column if not exists fulfilled boolean not null default false;

alter table election_2026_manual_rewards
add column if not exists fulfilled_date text;

create index if not exists election_2026_reward_rules_threshold_idx
on election_2026_reward_rules (threshold_votes);

create index if not exists election_2026_manual_rewards_user_idx
on election_2026_manual_rewards (user_name);

create index if not exists election_2026_reward_status_user_key_idx
on election_2026_reward_status (user_name, reward_key);

alter table election_2026_reward_rules enable row level security;
alter table election_2026_manual_rewards enable row level security;
alter table election_2026_reward_status enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'election_2026_reward_rules'
      and policyname = 'public read election 2026 reward rules'
  ) then
    create policy "public read election 2026 reward rules"
    on election_2026_reward_rules
    for select
    to anon, authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'election_2026_reward_rules'
      and policyname = 'admin write election 2026 reward rules'
  ) then
    create policy "admin write election 2026 reward rules"
    on election_2026_reward_rules
    for all
    to authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'election_2026_manual_rewards'
      and policyname = 'public read election 2026 manual rewards'
  ) then
    create policy "public read election 2026 manual rewards"
    on election_2026_manual_rewards
    for select
    to anon, authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'election_2026_manual_rewards'
      and policyname = 'admin write election 2026 manual rewards'
  ) then
    create policy "admin write election 2026 manual rewards"
    on election_2026_manual_rewards
    for all
    to authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'election_2026_reward_status'
      and policyname = 'public read election 2026 reward status'
  ) then
    create policy "public read election 2026 reward status"
    on election_2026_reward_status
    for select
    to anon, authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'election_2026_reward_status'
      and policyname = 'admin write election 2026 reward status'
  ) then
    create policy "admin write election 2026 reward status"
    on election_2026_reward_status
    for all
    to authenticated
    using (true)
    with check (true);
  end if;
end $$;

grant select on election_2026_reward_rules to anon;
grant select on election_2026_manual_rewards to anon;
grant select on election_2026_reward_status to anon;

grant select, insert, update, delete on election_2026_reward_rules to authenticated;
grant select, insert, update, delete on election_2026_manual_rewards to authenticated;
grant select, insert, update, delete on election_2026_reward_status to authenticated;

grant usage, select on sequence election_2026_reward_rules_id_seq to authenticated;
grant usage, select on sequence election_2026_manual_rewards_id_seq to authenticated;
grant usage, select on sequence election_2026_reward_status_id_seq to authenticated;
