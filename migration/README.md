# Catalyst Data Store migration

The files in `generated/` are derived from the Catalyst export archives in the repository root and the table CSV exports supplied for the remaining tables.

## Prepare the Bugs import

Catalyst CLI bulk imports stage the CSV through Stratus. The target project must contain at least one Stratus bucket before running `catalyst ds:import`. An Authenticated bucket with default settings is sufficient for migration staging.

Run:

```bash
node scripts/prepare-catalyst-migration.js prepare
```

This produces:

- `Bugs.import.csv`: import this after adding a temporary unique BigInt `legacy_rowid` column to the new Bugs table.
- `Bugs.retry-empty-category.csv`: the subset whose source category was empty, normalized to `Uncategorized` for the mandatory target column. Use this only after an initial import rejected those rows.
- `DebugSessions.pending-remap.csv`: an intermediate file whose `legacy_bug_id` values still refer to old Bugs ROWIDs. Do not import this file.

The script removes `ROWID`, `CREATORID`, `CREATEDTIME`, and `MODIFIEDTIME`. It retains application timestamps such as `verified_date`, `started_at`, and `ended_at`.

## Remap and import DebugSessions

After importing Bugs, export the new Bugs table with at least `ROWID` and `legacy_rowid`, then run:

```bash
node scripts/prepare-catalyst-migration.js remap path/to/new-bugs-export.csv
```

Import the resulting `generated/DebugSessions.import.csv`. The command stops without producing an import file if any parent mapping is missing or duplicated.

## Prepare the remaining tables

Place `Table-LongPendingBugs.csv`, `Table-LongPendingLogs.csv`, `Table-UserProfiles.csv`, and `Table-StabilizedCases.csv` in one directory, then run:

```bash
node scripts/prepare-catalyst-migration.js prepare-remaining path/to/export-directory
```

This removes Catalyst-managed columns and creates one `generated/<Table>.import.csv` file per table. It also validates unique application identifiers, profile values, and the relationship between long-pending logs and bugs. An export with only a header produces an import file with zero records and does not require a Catalyst import job.
