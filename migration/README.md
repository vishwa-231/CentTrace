# Catalyst Data Store migration

The files in `generated/` are derived from Catalyst Data Store CSV exports.

## Prepare a current full snapshot

Place the current `Table-*.csv` exports for Bugs, DebugSessions,
LongPendingBugs, LongPendingLogs, UserProfiles, StabilizedCases, and
AutomationChangesets in one directory, then run:

```bash
node scripts/prepare-catalyst-migration.js prepare-snapshot path/to/export-directory
```

This removes Catalyst-managed columns and produces:

- `Bugs.import.csv`: Bugs ready for import without changing the target schema.
- `Bugs.legacy-map.csv`: a local old-ROWID mapping manifest. Do not import it.
- `DebugSessions.pending-remap.csv`: sessions that still reference old Bugs ROWIDs. Do not import it.
- One `<Table>.import.csv` for each independent table.

The command validates Bugs uniqueness, every DebugSessions parent, and unique
application identifiers before producing the files. Empty source tables create
header-only files and do not require import jobs.

## Prepare the Bugs import

Catalyst CLI bulk imports stage the CSV through Stratus. The target project must contain at least one Stratus bucket before running `catalyst ds:import`. An Authenticated bucket with default settings is sufficient for migration staging.

The older archive-based workflow can still be run with:

```bash
node scripts/prepare-catalyst-migration.js prepare
```

This produces:

- `Bugs.import.csv`: import this after adding a temporary unique BigInt `legacy_rowid` column to the new Bugs table.
- `Bugs.retry-empty-category.csv`: the subset whose source category was empty, normalized to `Uncategorized` for the mandatory target column. Use this only after an initial import rejected those rows.
- `DebugSessions.pending-remap.csv`: an intermediate file whose `legacy_bug_id` values still refer to old Bugs ROWIDs. Do not import this file.

The script removes `ROWID`, `CREATORID`, `CREATEDTIME`, and `MODIFIEDTIME`. It retains application timestamps such as `verified_date`, `started_at`, and `ended_at`.

## Remap and import DebugSessions

After importing a current snapshot, export the complete new Bugs table, then run:

```bash
node scripts/prepare-catalyst-migration.js remap path/to/new-bugs-export.csv
```

The current-snapshot workflow matches imported Bugs through all application
columns and replaces each old DebugSessions `bug_id` with its new Bugs `ROWID`.
The older workflow still supports `legacy_rowid` when that column exists.
Import the resulting `generated/DebugSessions.import.csv`. The command stops
without producing an import file if any parent mapping is missing or duplicated.

## Prepare the remaining tables

Place `Table-LongPendingBugs.csv`, `Table-LongPendingLogs.csv`,
`Table-UserProfiles.csv`, `Table-StabilizedCases.csv`, and
`Table-AutomationChangesets.csv` in one directory, then run:

```bash
node scripts/prepare-catalyst-migration.js prepare-remaining path/to/export-directory
```

This removes Catalyst-managed columns and creates one `generated/<Table>.import.csv` file per table. It also validates unique application identifiers, profile values, and the relationship between long-pending logs and bugs. An export with only a header produces an import file with zero records and does not require a Catalyst import job.

## Completed Development migration

The 2026-10-14 migration from project `35915000000062033` to project
`20463000006264093` completed with these import results:

| Table | Imported | Failed |
| --- | ---: | ---: |
| Bugs | 446 | 0 |
| DebugSessions | 534 | 0 |
| LongPendingBugs | 23 | 0 |
| LongPendingLogs | 1 | 0 |
| UserProfiles | 5 | 0 |
| StabilizedCases | 0 | 0 |
| AutomationChangesets | 0 | 0 |

The Bugs import job was `20463000006260419`. DebugSessions were remapped from
the old Bugs ROWIDs using the 446-row post-import export, then imported in job
`20463000006243963`. The remaining import jobs were `20463000006261523`,
`20463000006248826`, and `20463000006248828`. Each downloaded error report is
header-only, consistent with the Catalyst job result of zero failures.
