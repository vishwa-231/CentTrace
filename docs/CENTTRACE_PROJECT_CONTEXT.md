# centTrace project context

Last updated: 2026-10-08

## Purpose

centTrace is a Zoho Catalyst web application for recording automation-bug debugging, measuring time, reviewing personal and team trends, tracking duplicate long-pending failures, and tracking unstabilized NEW CASE breakages.

The application requires Zoho/Catalyst sign-in. Data Store access is performed by the Advanced I/O function with Admin SDK scope, while the function obtains the authenticated Catalyst user and enforces owner/profile behavior itself.

## Active source layout

- `cent-trace/src/App.js`: Catalyst authentication wrapper and tracker iframe.
- `cent-trace/public/tracker/index.html`: deployed tracker markup and asset loading.
- `cent-trace/public/tracker/db-sync.js`: Data Store synchronization, CRM lookup, and timer start/pause/resume/complete API calls.
- `cent-trace/public/tracker/timer.js`: Today dashboard, live timers, pagination, completion and deletion UI.
- `cent-trace/public/tracker/historical-dashboard-v3.js`: Bug Summary charts and owner drill-down.
- `cent-trace/public/tracker/time-chart.js`: user/week time chart, daily bug breakdown, weekly and daily averages.
- `cent-trace/public/tracker/long-pending-dashboard.js`: Long Pending Issues dashboard and findings logs.
- `cent-trace/public/tracker/unstabilized-cases.js`: NEW CASE/Unique ID dashboard and Stabilized workflow.
- `cent-trace/public/tracker/restriction.js`: signed-in user's bugs from the CRM Restriction custom view.
- `cent-trace/public/tracker/profiles.js`: Admin profile management.
- `cent-trace/public/tracker/views.js`: hash/view navigation and role visibility.
- `cent-trace/public/tracker/analytics.css` and `timer.css`: tracker UI styles.
- `functions/cent_trace_function/handler.js`: all backend endpoints, Data Store access, Catalyst profiles, and CRM reads.
- `functions/cent_trace_function/catalyst-config.json`: Advanced I/O function deployment metadata. It contains no client secret.
- `catalyst.json`: deploy targets.

The similarly named HTML, CSS, and JavaScript files at the repository root are old prototypes. Do not modify them for current product changes.

## Data Store tables

The exact table names required by `handler.js` are:

### Bugs

Application columns:

- `bug_link`
- `bug_title`
- `milestone`
- `release_type`
- `category`
- `feature`
- `owner_zuid`
- `owner_name`
- `status`
- `verified_date`
- `total_elapsed_seconds`
- `notes`
- `assigned_user_name`
- `assigned_user_zuid`
- `failure_id`
- `source`
- `is_archived`

### DebugSessions

Application columns:

- `bug_id`: references the parent Bugs row ID.
- `started_at`
- `ended_at`
- `elapsed_seconds`
- `session_status`
- `started_by_zuid`
- `started_by_name`

### LongPendingBugs

- `failure_id`
- `feature_name`
- `breakage`
- `bug_link`
- `bug_title`
- `owner_name`

### LongPendingLogs

- `failure_id`
- `finding`
- `owner_name`
- `bug_link`

### UserProfiles

- `user_zuid`
- `user_name`
- `email`
- `role`: `ADMIN` or `STANDARD`.
- `is_active`

### StabilizedCases

- `unique_id`
- `feature_name`
- `stabilized_by_zuid`
- `stabilized_by_name`

## Authentication and profiles

- The web client uses Catalyst Embedded Authentication and a Zoho social-login-only form.
- Public Signup must be enabled in the Catalyst project for any Zoho user to sign in without a manual invitation.
- The backend rejects unauthenticated calls with HTTP 401.
- `UserProfiles` is the persistent role source.
- Users without a saved profile default to `STANDARD`.
- The initial Admin fallback allows `vishwa.sr@zohocorp.com`. The list is present in both `cent-trace/src/App.js` and `functions/cent_trace_function/handler.js`.
- A saved `UserProfiles` role takes precedence over the initial Admin fallback.
- Standard users see only their own live Bugs, Bug Summary data, Long Pending Issues, and other owner-scoped data.
- Admin users can inspect organization-wide Bug Summary data, select users in Time Chart, and manage profiles.

## CRM connections

The function performs CRM GET requests only. Never modify CRM data.

Required Catalyst Connection Link Names:

- `crm_bug_lookup`: reads Bugs custom-module records. Minimum OAuth scope: `ZohoCRM.modules.custom.READ`.
- `crm_org_users`: reads all CRM organization users. Minimum OAuth scope: `ZohoCRM.users.READ`.

These names are constants near the top of `functions/cent_trace_function/handler.js`. Connections and OAuth grants are project-specific and must be recreated when moving Catalyst projects. If different link names are created, update the constants and redeploy.

CRM lookups use the India API domain and CRM v8 endpoints. The application retrieves only fields such as Name, Report_Name, Feature_Name, Unique_ID, FailureID, and Breakage. Exact-record requests do not send list-only approval/conversion filters; if CRM v8 returns a server/compatibility error, the read is retried through v2.2. Unstabilized-case enrichment first performs a batched ID lookup and then fetches unmatched records and records with blank Unique IDs through this exact-record path. The complete-record fallback accepts populated alternate/numbered Unique ID API names such as `Unique_ID_1`. If the connection cannot access requested records, or the Unique ID field is empty or hidden for every record, the API reports the specific CRM connection/field problem instead of silently returning empty Unique IDs.

## Product behavior already implemented

- Today shows only the authenticated user's investigating bugs and bugs closed today.
- Fixed This Week on Today is authenticated-user-specific and calculated server-side.
- Weeks run Sunday 12:00 AM through Saturday 11:59 PM in Asia/Kolkata.
- Bug Summary is organization-wide for Admin and owner-specific for Standard users.
- Bug Summary includes the provided Excel workbook history plus fixed Data Store bugs.
- Live tracker lists never use browser fallback records; current bugs come from Data Store.
- All-bugs pagination is ten bugs per page.
- Active timer state survives reload and duplicated tabs through persisted DebugSessions timing.
- Timers support pause and resume.
- Completing a bug stores duration, category, notes, optional assigned user, and CRM-derived metadata.
- Assignment is shown only for `PI_FiledBy_RT`, `ChangedToAnotherAD`, and `AssignedByAD`.
- The CRM user selector supports search, arrow keys, Enter, and displays name/email while selecting.
- Bug Summary owner drill-down shows every category and feature in fixed-height internally scrollable cards, with distinct category/feature counts.
- Time Chart is user selectable for Admin, week navigable from September 2026 to the current week, and displays daily bugs sorted by descending duration.
- Time Chart shows total time and average time per completed bug for the week and selected day.
- Bug rows open a shared read-only detail dialog from Today, Bug Summary, and Time Chart.
- Duplicate Failure IDs offer a confirmation before adding/updating Long Pending Bugs.
- The duplicate Failure ID confirmation embeds the existing Long Pending bug, its metadata, recent findings, and actions to open the saved bug or view/add logs.
- Long Pending records are grouped by feature and store owner, current bug link, breakage, and findings logs.
- Deleting a completed Long Pending bug can also remove LongPendingBugs and LongPendingLogs records after confirmation.
- Bugs whose CRM title contains NEW CASE BREAKAGE are shown in Unstabilized Cases, grouped by CRM Unique ID and feature.
- Restriction fetches every record from CRM custom view `1034369000840611390` with CRM page-token pagination (up to the API limit of 100,000 records), then matches Bug Owner to the authenticated user by CRM user ID, email, or normalized name. Finishing a Restriction timer changes that exact CRM record to Closed immediately and keeps it Closed after reload for the rest of the India calendar day. A completion with an assigned user represents a finished handoff such as `ChangedToAnotherAD` and remains Closed beyond that day. Older ordinary completion history does not prevent a CRM-open bug from being started again. Investigating and paused Restriction bugs persisted in Data Store are merged into the live CRM result so they remain visible after reload even if CRM no longer returns them. The owner-specific result is paginated at ten records per page. A row moves through Start debugging, Pause/Resume, and Finish debugging without navigating away from Restriction. Starting a Restriction bug opens CRM in a new tab only after its timer is successfully created, while finishing opens CRM after the result is saved. CRM batch counts, record IDs, pagination tokens, duplicate IDs, owner resolution, and the client/server owner count are checked so an incomplete list fails visibly instead of appearing valid.
- Today captures the authenticated user's Restriction bug count for each India calendar day and shows a top-level pie chart with the percentage completed that day. The per-user daily baseline is stored in browser local storage and self-heals as the union of its existing rows, the current CRM Restriction rows, and Restriction bugs completed that day. This prevents a transient empty CRM result from permanently saving `0 closed / 0 remaining / 0 total`, and the baseline still does not shrink as CRM removes completed bugs from the live custom view. If centTrace remains open across 12:00 AM Asia/Kolkata, it clears the previous in-memory daily list, returns the progress card to its loading state, and fetches the CRM Restriction view again before initializing the new day's baseline.
- Stabilizing a Unique ID requires confirmation and server-side ownership verification; only the authenticated owner of the source bug can perform it. Stabilized cases move to a separate tab and remain available for review.
- StabilizedCases reads use the Data Store paged-row API so a configured but empty table returns an empty list instead of being reported as missing.

## Historical workbook

`Complete Bug Analysis.xlsx` supplies historical analytics records. Imported workbook rows are stored in browser local storage and used only by Bug Summary. They are marked `imported` and never appear as live tracker timers.

## Active Catalyst project

- Account: `vishwa.sr@zohocorp.com`
- Organization and Development environment ID: `60070076632`
- Project: `CentTrace` (`35915000000062033`)
- App: `https://centtrace-60070076632.development.catalystserverless.in/app/`

The workspace `.catalystrc` targets this existing project. The application uses the existing project's Embedded Authentication, Data Store tables, users, and CRM connections. Migration utilities and exports in `scripts/` and `migration/` are retained only as historical artifacts and are not part of the active deployment flow.

## Build, cache busting, and deployment

For tracker JavaScript changes:

```bash
node --check cent-trace/public/tracker/<changed-file>.js
```

Build:

```bash
cd cent-trace
npm run build
```

Client asset query versions in `cent-trace/public/tracker/index.html` and the iframe query in `cent-trace/src/App.js` are intentionally bumped after client changes because the deployed app and iframe are aggressively cached.

Deploy from the repository root only after confirming the active account/project:

```bash
cd /Users/vishwa-15681/Desktop/centTrace
catalyst whoami
catalyst project:list
catalyst deploy
```

Deployment builds the React client and deploys `cent_trace_function`. The app uses project-relative `/server/cent_trace_function/...` URLs and `/__catalyst/sdk/init.js`.

## Deployment smoke test

After deployment, validate in this order:

1. Zoho social login and logout.
2. The signed-in account is Admin where expected.
3. CRM Bug URL lookup fills title, milestone, release, feature, Failure ID, Unique ID, and breakage.
4. Start, reload, duplicate tab, pause, resume, and finish a timer.
5. Today shows only the signed-in user's current data.
6. Bug Summary shows the correct role-based scope.
7. Time Chart totals, averages, daily drill-down, and user filtering are correct.
8. Long Pending duplicate confirmation, replacement link, findings logs, and deletion work.
9. Unstabilized NEW CASE grouping and Stabilized removal work.
10. Admin profile promotion/demotion persists in UserProfiles.
