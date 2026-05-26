# Versioning

This project uses human-managed release versions.

## Current Version

```text
v1.0 测试版
```

The visible page badge is currently written in `index.html`.

`version.json` records the release metadata, but the page does not automatically read it yet. This avoids adding fetch behavior that may be unreliable when the site is opened directly as a local file.

## Version Rules

- `v1.0 测试版`: current test version.
- `v1.1`, `v1.2`: small UI, documentation, or admin usability updates.
- `v1.x`: compatible improvements that do not require a full relaunch.
- `v2.0 正式版`: stable public release after data, admin, and release process are proven.

## When To Update Version

Update the version when preparing a release, not for every commit.

Update these files together:

- `version.json`
- `CHANGELOG.md`
- `index.html` visible version badge, if the user-facing version changes

## Database Changes

If a release changes Supabase schema, policies, or functions:

- Update `database/schema.sql`, `database/policies.sql`, or `database/functions.sql`.
- Add a changelog note.
- Mention whether existing Supabase projects need a manual SQL step.

## Recommended Release Labels

Examples:

- `v1.0 测试版`
- `v1.1 测试版`
- `v1.2 测试版`
- `v2.0 正式版`
