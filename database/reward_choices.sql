create table if not exists reward_choice_options (
  id bigint generated always as identity primary key,
  source_type text not null check (source_type in ('pk','birth','special')),
  event_name text,
  reward_name text not null,
  choice_options jsonb not null default '[]'::jsonb,
  is_choice_required boolean default true,
  note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(source_type, event_name, reward_name)
);

create table if not exists reward_choices (
  id bigint generated always as identity primary key,
  user_name text not null,
  source_type text not null check (source_type in ('pk','birth','special')),
  event_name text,
  reward_name text not null,
  selected_choice text,
  choice_status text not null default 'pending' check (choice_status in ('pending','selected')),
  note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_name, source_type, event_name, reward_name)
);

alter table reward_choice_options enable row level security;
alter table reward_choices enable row level security;

create policy "public read reward_choice_options"
on reward_choice_options for select
using (true);

create policy "public read reward_choices"
on reward_choices for select
using (true);

create policy "admin write reward_choice_options"
on reward_choice_options for all
to authenticated
using (true)
with check (true);

create policy "admin write reward_choices"
on reward_choices for all
to authenticated
using (true)
with check (true);
