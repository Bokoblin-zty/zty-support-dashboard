# Database Setup

This directory records the Supabase schema used by the data station.

Run order for a new Supabase project:

1. `schema.sql`
2. `policies.sql`
3. `functions.sql`

Feature add-ons used by the current front end:

4. `reward_progress.sql`
5. `questions.sql`
6. `reward_choices.sql`
7. `visit_logs.sql`

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
- `reward_choice_options`
- `reward_choices`
- `visit_logs`
- `operation_logs`

The front end currently uses this RPC:

- `get_question_by_code(code text)`

Notes:

- Public users can read front-facing data, submit anonymous questions, and query a question by code.
- Authenticated admins can write management data, answer questions, publish announcements, and maintain reward progress.
- `reward_progress` tracks overall production progress for rewards.
- `questions` stores anonymous questions and admin replies.
- `reward_choice_options` and `reward_choices` store selectable reward choices.
- `visit_logs` stores anonymous visit records for admin statistics.
