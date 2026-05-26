-- Zhou Tongyue Support Data Station
-- Row level security and access policies.
-- Run after schema.sql.

alter table pk_events enable row level security;
alter table pk_records enable row level security;
alter table birth_fund_records enable row level security;
alter table name_aliases enable row level security;
alter table reward_rules enable row level security;
alter table reward_status enable row level security;
alter table birth_reward_rules enable row level security;
alter table birth_reward_status enable row level security;
alter table special_rank_rewards enable row level security;
alter table reward_progress enable row level security;
alter table announcements enable row level security;
alter table lottery_records enable row level security;
alter table questions enable row level security;
alter table operation_logs enable row level security;

create policy "public read pk_events"
on pk_events for select
using (true);

create policy "public read pk_records"
on pk_records for select
using (true);

create policy "public read birth_fund_records"
on birth_fund_records for select
using (true);

create policy "public read name_aliases"
on name_aliases for select
using (true);

create policy "public read reward_rules"
on reward_rules for select
using (true);

create policy "public read reward_status"
on reward_status for select
using (true);

create policy "public read birth_reward_rules"
on birth_reward_rules for select
using (true);

create policy "public read birth_reward_status"
on birth_reward_status for select
using (true);

create policy "public read special_rank_rewards"
on special_rank_rewards for select
using (true);

create policy "public read reward_progress"
on reward_progress for select
using (true);

create policy "public read announcements"
on announcements for select
using (is_visible = true);

create policy "public read lottery_records"
on lottery_records for select
using (true);

create policy "public insert questions"
on questions for insert
with check (true);

create policy "admin write pk_events"
on pk_events for all
to authenticated
using (true)
with check (true);

create policy "admin write pk_records"
on pk_records for all
to authenticated
using (true)
with check (true);

create policy "admin write birth_fund_records"
on birth_fund_records for all
to authenticated
using (true)
with check (true);

create policy "admin write name_aliases"
on name_aliases for all
to authenticated
using (true)
with check (true);

create policy "admin write reward_rules"
on reward_rules for all
to authenticated
using (true)
with check (true);

create policy "admin write reward_status"
on reward_status for all
to authenticated
using (true)
with check (true);

create policy "admin write birth_reward_rules"
on birth_reward_rules for all
to authenticated
using (true)
with check (true);

create policy "admin write birth_reward_status"
on birth_reward_status for all
to authenticated
using (true)
with check (true);

create policy "admin write special_rank_rewards"
on special_rank_rewards for all
to authenticated
using (true)
with check (true);

create policy "admin write reward_progress"
on reward_progress for all
to authenticated
using (true)
with check (true);

create policy "admin write announcements"
on announcements for all
to authenticated
using (true)
with check (true);

create policy "admin write lottery_records"
on lottery_records for all
to authenticated
using (true)
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

create policy "admin read operation_logs"
on operation_logs for select
to authenticated
using (true);

create policy "admin write operation_logs"
on operation_logs for insert
to authenticated
with check (true);
