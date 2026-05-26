create table if not exists questions (
  id bigint generated always as identity primary key,
  query_code text not null unique,
  question_text text not null,
  answer_text text,
  answered_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table questions enable row level security;

create policy "public insert questions"
on questions for insert
with check (true);

create policy "admin read questions"
on questions for select
to authenticated
using (true);

create policy "admin update questions"
on questions for update
to authenticated
using (true)
with check (true);

create or replace function get_question_by_code(code text)
returns table (
  query_code text,
  question_text text,
  answer_text text,
  answered_at timestamp with time zone,
  created_at timestamp with time zone
)
language sql
security definer
set search_path = public
as $$
  select q.query_code, q.question_text, q.answer_text, q.answered_at, q.created_at
  from questions q
  where q.query_code = code
  limit 1;
$$;

grant execute on function get_question_by_code(text) to anon;
grant execute on function get_question_by_code(text) to authenticated;
