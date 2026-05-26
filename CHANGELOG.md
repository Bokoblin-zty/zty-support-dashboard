# Changelog

## v1.0 测试版

Initial test version of 周童玥应援会数据站.

### Frontend

- Refined the site positioning as a support data station.
- Added clear first-level entries for data overview, rankings, reward lookup, announcements, lottery results, and anonymous questions.
- Improved desktop UI language for overview, rankings, announcements, lottery results, and anonymous questions.
- Improved mobile-first layout and ranking readability.
- Preserved TOP3 gold/silver/bronze styling.

### Data And Rewards

- Added combined total, general election, and birthday fund data views.
- Added general election ranking, single-event ranking, birthday fund ranking, and combined ranking.
- Added reward lookup for general election, birthday fund, and special rank rewards.
- Added reward production progress display.
- Kept birthday message book reward as highest-tier-only.

### Admin

- Added admin management overview.
- Improved admin grouping for data, rewards, content interaction, and system logs.
- Added announcement management with image support.
- Added lottery pool generation, draw confirmation, and locked result records.
- Added anonymous question reply management.
- Added operation log viewing.

### Database

- Added `questions.sql`.
- Added `reward_progress.sql`.
- Added `database/schema.sql`, `database/policies.sql`, and `database/functions.sql`.
- Added release checklist and database setup documentation.
