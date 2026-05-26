# Database Setup

This directory records the Supabase schema used by the data station.

Run order for a new Supabase project:

1. `schema.sql`
2. `policies.sql`
3. `functions.sql`

The front end currently uses these tables:

- `pk_events`
- `pk_records`
- `birth_fund_records`
- `name_aliases`
- `reward_rules`
- `reward_status`
- `birth_reward_rules`
- `birth_reward_status`
- `special_rank_rewards`
- `reward_progress`
- `announcements`
- `lottery_records`
- `questions`
- `operation_logs`

The front end currently uses this RPC:

- `get_question_by_code(code text)`

Notes:

- Public users can read front-facing data, submit anonymous questions, and query a question by code.
- Authenticated admins can write management data, answer questions, publish announcements, and maintain reward progress.
- `reward_progress` tracks overall production progress for rewards.
- `questions` stores anonymous questions and admin replies.
