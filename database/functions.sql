-- Zhou Tongyue Support Data Station
-- Database functions.
-- Run after schema.sql and policies.sql.

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
