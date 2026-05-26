-- Zhou Tongyue Support Data Station
-- Core Supabase table schema.
-- Run this before policies.sql and functions.sql when initializing a new project.

create table if not exists pk_events (
  id bigint generated always as identity primary key,
  event_name text not null unique,
  event_date text,
  sort_order int default 0,
  is_general_election boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists pk_records (
  id bigint generated always as identity primary key,
  event_name text not null,
  user_name text not null,
  amount numeric not null,
  created_at timestamp with time zone default now()
);

create table if not exists birth_fund_records (
  id bigint generated always as identity primary key,
  user_name text not null,
  amount numeric not null,
  batch_name text,
  created_at timestamp with time zone default now()
);

create table if not exists name_aliases (
  id bigint generated always as identity primary key,
  alias_name text not null unique,
  canonical_name text not null,
  created_at timestamp with time zone default now()
);

create table if not exists reward_rules (
  id bigint generated always as identity primary key,
  event_name text not null,
  threshold numeric not null,
  reward_name text not null,
  sort_order int default 0,
  created_at timestamp with time zone default now(),
  unique(event_name, threshold, reward_name)
);

create table if not exists reward_status (
  id bigint generated always as identity primary key,
  user_name text not null,
  event_name text not null,
  reward_name text not null,
  fulfilled boolean default false,
  fulfilled_date text,
  created_at timestamp with time zone default now(),
  unique(user_name, event_name, reward_name)
);

create table if not exists birth_reward_rules (
  id bigint generated always as identity primary key,
  reward_group text not null,
  threshold numeric not null,
  reward_name text not null,
  sort_order int default 0,
  created_at timestamp with time zone default now()
);

create table if not exists birth_reward_status (
  id bigint generated always as identity primary key,
  user_name text not null,
  reward_group text not null,
  reward_name text not null,
  fulfilled boolean default false,
  fulfilled_date text,
  note text,
  created_at timestamp with time zone default now(),
  unique(user_name, reward_group, reward_name)
);

create table if not exists special_rank_rewards (
  id bigint generated always as identity primary key,
  event_name text not null,
  reward_name text not null,
  provider_name text,
  target_rank int not null,
  winner_name text not null,
  status text default 'pending',
  fulfilled boolean default false,
  fulfilled_date text,
  note text,
  created_at timestamp with time zone default now()
);

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

create table if not exists announcements (
  id bigint generated always as identity primary key,
  title text not null,
  content text not null,
  is_pinned boolean default false,
  is_visible boolean default true,
  created_at timestamp with time zone default now()
);

create table if not exists lottery_records (
  id bigint generated always as identity primary key,
  lottery_type text not null,
  lottery_name text not null,
  rule_text text,
  pool_json jsonb,
  winners_json jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists questions (
  id bigint generated always as identity primary key,
  query_code text not null unique,
  question_text text not null,
  answer_text text,
  answered_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

create table if not exists operation_logs (
  id bigint generated always as identity primary key,
  admin_email text,
  action text not null,
  detail text,
  metadata jsonb,
  created_at timestamp with time zone default now()
);

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
