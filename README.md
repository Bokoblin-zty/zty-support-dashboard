# zty-support-dashboard

周童玥应援会数据站。

这是一个部署在 Netlify 的静态数据站，前端直接连接 Supabase。主页面用于展示总选集资、生公集资、奖励兑现、公告通知、抽奖结果和匿名提问；管理员后台用于维护数据、公告、抽奖、奖励和操作记录。

## Project Structure

```text
index.html
app.js
styles/
  base.css
  layout.css
  cards.css
  admin.css
  table.css
  mobile.css
database/
  schema.sql
  policies.sql
  functions.sql
  README.md
docs/
  release-flow.md
  versioning.md
CHANGELOG.md
RELEASE_CHECKLIST.md
version.json
questions.sql
reward_progress.sql
```

## Frontend

- `index.html`: page shell, navigation, admin modal, script/style references.
- `app.js`: Supabase initialization, data loading, ranking, rewards, announcements, lottery, questions, admin actions.
- `styles/`: modular CSS for base controls, layout, cards, tables, admin, and mobile.

## Supabase

The complete database setup is documented in `database/`.

Run order for a new Supabase project:

1. `database/schema.sql`
2. `database/policies.sql`
3. `database/functions.sql`

Standalone compatibility files are also kept:

- `questions.sql`
- `reward_progress.sql`

## Release Check

Before pushing a release:

```bash
node --check app.js
git diff --check
```

Then manually verify the checklist in `RELEASE_CHECKLIST.md`.

## Release And Versioning

- Current release metadata is stored in `version.json`.
- User-facing release notes are stored in `CHANGELOG.md`.
- Release steps are documented in `docs/release-flow.md`.
- Version rules are documented in `docs/versioning.md`.
