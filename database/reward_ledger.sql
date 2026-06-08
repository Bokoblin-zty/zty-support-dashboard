-- Reward ledger table for the staged reward-system refactor.
-- This file is non-destructive: it only creates a new table, indexes, and RLS policies.
-- It does not modify or delete existing reward tables.

create table if not exists reward_ledger (
  id bigint generated always as identity primary key,
  ledger_key text not null unique,
  ledger_version text default 'stage1-readonly',
  source_type text not null check (source_type in ('pk','birth','special','other')),
  source_label text,
  source_table text,
  source_id text,
  user_name text not null,
  event_name text,
  reward_group text,
  reward_name text not null,
  display_reward_name text,
  amount numeric default 0,
  provider_type text default 'support_club' check (provider_type in ('support_club','zhou_tongyue')),
  provider_label text,
  fulfilled boolean default false,
  fulfillment_status text default 'unfulfilled' check (fulfillment_status in ('fulfilled','unfulfilled')),
  fulfilled_date text,
  choice_required boolean default false,
  choice_status text default 'not_required' check (choice_status in ('not_required','pending','selected')),
  selected_reward_name text,
  progress_reward_name text,
  progress_status text,
  progress_note text,
  workflow_status text default 'pending_fulfillment' check (workflow_status in ('pending_choice','needs_progress','pending_fulfillment','completed')),
  special_status text,
  note text,
  synced_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists reward_ledger_user_name_idx on reward_ledger (user_name);
create index if not exists reward_ledger_source_type_idx on reward_ledger (source_type);
create index if not exists reward_ledger_event_name_idx on reward_ledger (event_name);
create index if not exists reward_ledger_reward_name_idx on reward_ledger (reward_name);
create index if not exists reward_ledger_workflow_status_idx on reward_ledger (workflow_status);
create index if not exists reward_ledger_fulfilled_idx on reward_ledger (fulfilled);

alter table reward_ledger enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'reward_ledger'
      and policyname = 'admin read reward_ledger'
  ) then
    create policy "admin read reward_ledger"
    on reward_ledger for select
    to authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'reward_ledger'
      and policyname = 'admin insert reward_ledger'
  ) then
    create policy "admin insert reward_ledger"
    on reward_ledger for insert
    to authenticated
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'reward_ledger'
      and policyname = 'admin update reward_ledger'
  ) then
    create policy "admin update reward_ledger"
    on reward_ledger for update
    to authenticated
    using (true)
    with check (true);
  end if;
end $$;
