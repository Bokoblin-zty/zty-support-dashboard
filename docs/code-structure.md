# Code Structure Guide

This project is a static Netlify site backed by Supabase. The current structure keeps the public page, admin tools, and data logic in a small number of files so simple deploys remain easy.

## Entry Files

- `index.html`: page markup and fixed DOM anchors used by `app.js`.
- `app.js`: Supabase initialization, data loading, ranking, rewards, announcements, lottery, questions, Excel import, admin actions, and event binding.
- `styles/`: modular CSS files loaded by `index.html`.

## CSS Modules

- `styles/base.css`: design tokens, body, buttons, inputs, common utilities.
- `styles/layout.css`: page layout, header, wrapper, grids, navigation.
- `styles/cards.css`: data cards, overview cards, lookup panels.
- `styles/admin.css`: admin modal, admin tabs, admin forms, admin table wrappers.
- `styles/table.css`: public tables, ranking lists, reward lists, announcements, lottery, questions.
- `styles/mobile.css`: mobile-only responsive rules.

## Database References

- `database/questions.sql`: anonymous question system setup.
- `database/reward_choices.sql`: selectable reward options and user choices.
- `database/visit_logs.sql`: anonymous visit statistics setup.
- `database/reward_progress.sql`: reward production progress setup.
- `database/schema.sql`: consolidated table definitions.
- `database/policies.sql`: consolidated RLS policy reference.
- `database/functions.sql`: consolidated SQL functions.

## Maintenance Rules

- Keep Supabase URL and publishable key unchanged unless the deployment target changes.
- Keep fixed element IDs stable because `app.js` binds to them directly.
- Put reusable visual styling in CSS classes instead of inline styles.
- Prefer adding small focused helpers over rewriting existing business logic.
- Run `node --check app.js` and `git diff --check` before committing.
