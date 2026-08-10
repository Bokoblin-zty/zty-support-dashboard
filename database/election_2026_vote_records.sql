create table if not exists election_2026_vote_records (
  id bigint generated always as identity primary key,
  source_type text not null check (
    source_type in (
      'public_vote',
      'dark_unrevealed',
      'dark_revealed',
      'dark_link_amount'
    )
  ),
  user_name text not null,
  value numeric not null default 0 check (value >= 0),
  batch_name text,
  note text,
  created_at timestamp with time zone default now()
);

alter table election_2026_vote_records
add column if not exists note text;

create index if not exists election_2026_vote_records_source_idx
on election_2026_vote_records (source_type);

create index if not exists election_2026_vote_records_user_idx
on election_2026_vote_records (user_name);

alter table election_2026_vote_records enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'election_2026_vote_records'
      and policyname = 'public read election 2026 vote records'
  ) then
    create policy "public read election 2026 vote records"
    on election_2026_vote_records
    for select
    to anon, authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'election_2026_vote_records'
      and policyname = 'admin write election 2026 vote records'
  ) then
    create policy "admin write election 2026 vote records"
    on election_2026_vote_records
    for all
    to authenticated
    using (true)
    with check (true);
  end if;
end $$;

grant select on election_2026_vote_records to anon;
grant select, insert, update, delete on election_2026_vote_records to authenticated;
grant usage, select on sequence election_2026_vote_records_id_seq to authenticated;
