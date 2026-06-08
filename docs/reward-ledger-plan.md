# Reward Ledger Refactor Plan

## Goal

The reward system should eventually operate around one user reward ledger. Existing tables stay intact until the new ledger is verified against the current reward views.

## Safety Rules

- Do not delete existing reward tables during the refactor.
- Do not overwrite historical fulfillment, choice, or progress data.
- Use deterministic ledger keys so the same earned reward can be updated without creating duplicates.
- Keep old reward queries available until the ledger output matches current user-facing results.
- Run static checks after each phase before moving to the next phase.

## Phase 1: Read-Only Mapping

Status: complete.

The code now includes a read-only ledger mapper:

- `buildRewardLedgerRows()`
- `rewardLedgerMetrics()`

This mapper reads existing data only. It does not insert, update, delete, or migrate records.

## Existing Data Mapping

| Current source | Ledger meaning | Notes |
| --- | --- | --- |
| `reward_rules` + `pk_records` + `reward_status` | Total-election earned rewards | Keeps existing fulfillment status from `reward_status`. |
| `birth_reward_rules` + `birth_fund_records` + `birth_reward_status` | Birthday earned rewards | Keeps highest-only birthday rule behavior. |
| `special_rank_rewards` | Special rank rewards | Keeps special status and fulfillment date. |
| `reward_choice_options` + `reward_choices` | Choice-required rewards | Pending choice remains pending until a selected reward is saved. |
| `reward_progress` | Reward production/progress state | Selected choice reward uses its own progress when available. |

## Ledger Field Design

| Field | Purpose |
| --- | --- |
| `ledger_key` | Stable unique key for future upsert/migration. |
| `source_type` | `pk`, `birth`, or `special`. |
| `user_name` | Canonical user ID after alias cleanup. |
| `event_name` | PK event, birthday group, or special event. |
| `reward_name` | Original earned reward rule name. |
| `display_reward_name` | Selected reward name when a choice has been made. |
| `provider_type` | `support_club` or `zhou_tongyue`. |
| `fulfillment_status` | `fulfilled` or `unfulfilled`. |
| `choice_status` | `not_required`, `pending`, or `selected`. |
| `progress_status` | Current progress of selected/display reward. |
| `workflow_status` | `pending_choice`, `needs_progress`, `pending_fulfillment`, or `completed`. |

## Next Phase

Phase 2 adds a non-destructive database table for the ledger, then compares generated ledger rows against stored rows before switching any UI to read from that table.

## Phase 2: Shadow Ledger Sync

Status: complete.

The admin reward center now has a ledger sync check in the reward pending page.

This phase:

- Reads `reward_ledger`.
- Compares generated ledger rows against stored ledger rows.
- Allows admin-triggered upsert into `reward_ledger`.
- Does not delete stale ledger rows automatically.
- Does not switch the public reward query or admin fulfillment flow to the ledger yet.

The existing reward tables remain the source of truth during this phase.

## Phase 3: Admin Ledger View

Status: complete.

The admin reward fulfillment list now renders through the ledger-shaped view.

This phase:

- Uses generated ledger rows for the admin reward list, filters, export, and quick fulfillment.
- Merges stored ledger sync metadata when available.
- Keeps existing reward tables as the source of truth for fulfillment writes.
- Syncs a changed fulfillment row back into `reward_ledger` after a successful old-table update.

## Phase 4: Public Reward Query

Status: complete.

The public reward lookup now prefers the ledger-shaped reward rows.

This phase:

- Keeps the familiar public grouping: total-election rewards, birthday rewards, and special rank rewards.
- Shows the concrete selected reward when a choice has been saved.
- Shows pending choice rewards as pending choice until an admin saves a selection.
- Shows progress/fulfillment state from the ledger-shaped row.
- Keeps the legacy reward lookup renderer as a fallback when ledger data is unavailable.

## Phase 5: Stabilization

Status: complete.

No legacy reward tables or historical records were deleted.

The refactor is now in a safe transitional state:

- Old tables remain the write-safe source of truth for fulfillment and choice operations.
- `reward_ledger` can be regenerated from existing data.
- Admin views and public reward lookup read through the same ledger-shaped model.
- Static checks should still be run before every release.

Do not remove legacy reward functions until the ledger output has been checked against real user-facing reward results after deployment.
