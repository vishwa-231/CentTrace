# centTrace project context

Last updated: 2026-10-28

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
- `cent-trace/public/tracker/dropdowns.js`: shared outside-click, Escape, view-change, and dialog-close behavior for custom dropdowns.
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
- `dependency_service_name`: Text column. Populated only when a bug closes as `OtherDependencyIssues` (CRM Automation Bug Status "Dependency Service"), from CRM's `Dependency_Service_Name` field. Kept separate from `assigned_user_name`/`assigned_user_zuid` (which are reserved for reassigned/reporting users) to avoid confusing the two.
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

### AutomationChangesets

- `bug_url`: CRM bug URL that first introduced the changeset.
- `automation_changeset`: unique CRM Automation Changeset value, first stored by the bug that introduces it (row's `CREATEDTIME`, in India time, marks that first-use day). Any bug — including the same bug reopened later, or a different bug — closed with that same changeset on that same India-calendar day is categorized `AutomationCodeFix`. Starting the next India-calendar day, any bug (the same one reopened, or a different one) closed with that changeset is categorized `AlreadyFixed_AI`, permanently (the day only ever advances, so this never reverts to `AutomationCodeFix`).

## Authentication and profiles

- The web client uses Catalyst Embedded Authentication and a Zoho social-login-only form.
- Public Signup must be enabled in the Catalyst project for any Zoho user to sign in without a manual invitation.
- The backend rejects unauthenticated calls with HTTP 401.
- `UserProfiles` is the persistent role source.
- Users without a saved profile default to `ADMIN`.
- A saved `UserProfiles` role takes precedence, so an admin can still downgrade a specific user to `STANDARD`.
- Standard users see only their own live Bugs, Bug Summary data, Long Pending Issues, and other owner-scoped data.
- Admin users can inspect organization-wide Bug Summary data (via a user picker, same pattern as Time Chart), select users in Time Chart, and manage profiles.

## CRM connections

The function performs CRM GET requests only. Never modify CRM data.

Required Catalyst Connection Link Names:

- `crm_bug_lookup`: reads Bugs custom-module records and manages its change-notification subscription. OAuth scopes: `ZohoCRM.modules.READ` and `ZohoCRM.notifications.CREATE`.
- `crm_org_users`: reads all CRM organization users. Minimum OAuth scope: `ZohoCRM.users.READ`.

The active Development project has connected resources with link names `crm_bug_lookup` and `crm_org_users`, matching the function constants. It also has `crm_restriction_bugs_user`, which the current function does not use. The restriction connection must not be substituted for `crm_bug_lookup` because it has broader module access and does not supply the notification permission.

These names are constants near the top of `functions/cent_trace_function/handler.js`. Connections and OAuth grants are project-specific and must be recreated when moving Catalyst projects. If different link names are created, update the constants and redeploy.

CRM lookups use the India API domain and CRM v8 endpoints. The application retrieves only fields such as Name, Report_Name, Feature_Name, Unique_ID, FailureID, and Breakage. Exact-record requests do not send list-only approval/conversion filters; if CRM v8 returns a server/compatibility error, the read is retried through v2.2. Unstabilized-case enrichment first performs a batched ID lookup and then fetches unmatched records and records with blank Unique IDs through this exact-record path. The complete-record fallback accepts populated alternate/numbered Unique ID API names such as `Unique_ID_1`. If the connection cannot access requested records, or the Unique ID field is empty or hidden for every record, the API reports the specific CRM connection/field problem instead of silently returning empty Unique IDs.

CRM bug changes are received at `POST /crm/notifications/webhook`. This is the only function route intended to accept a request without a Catalyst user session. It validates the notification `token` against the `CRM_NOTIFICATION_TOKEN` function environment variable, ignores CRM records that have no active centTrace bug, then reads and reconciles only the affected tracked records. Configure `CRM_NOTIFICATION_URL`, `CRM_NOTIFICATION_TOKEN`, and `CRM_NOTIFICATION_CHANNEL_ID` as function environment variables. In the active Development project, `CRM_NOTIFICATION_URL` is `https://centtrace-60047414473.development.catalystserverless.in/server/cent_trace_function/crm/notifications/webhook`. An authenticated Admin can create or renew the seven-day CRM `Bugs.edit` subscription through `POST /crm/notifications/subscribe`, and the Admin-only Profiles page has a "Reconnect CRM sync" button that calls this same route. The webhook handler also self-renews this subscription on every successful notification (best-effort, swallowing failures) so the channel's expiry keeps getting pushed out as long as CRM edits keep happening — this is what prevents the subscription from silently lapsing after ~7 days of no manual renewal, which previously caused tracked bugs to permanently stop closing in centTrace no matter how many times they were re-fixed in CRM (no notifications were arriving at all once the channel expired). If CRM edits ever stop reflecting in centTrace again (e.g. after the Development project itself has been idle for a long stretch), use the Reconnect CRM sync button first before investigating category logic. Catalyst Security Rules must allow the webhook route while keeping all other function routes authenticated.

## Product behavior already implemented

- Today shows only the authenticated user's investigating bugs and bugs closed today.
- Fixed This Week on Today is authenticated-user-specific and calculated server-side.
- Weeks run Sunday 12:00 AM through Saturday 11:59 PM in Asia/Kolkata.
- Bug Summary is scoped to the signed-in user by default. Its Data Store history is loaded through the owner-scoped `/bugs/summary` endpoint, then combined with that user's imported workbook history. `/bugs/summary` and `POST /bugs/classification` use `isStoredBugOwner` (Catalyst user identifier or exact normalized owner name) because the 2026-10-14 migrated Bugs keep the previous project's `owner_zuid`; a strict identifier match hid every bug before the migration date. Workbook rows carry first names only ("Vishwa", "Harish"), so `historical-dashboard-v3.js` also matches them against the first word of the signed-in display name. Admin profiles additionally get a user picker (same pattern as the Time Chart picker, backed by `GET /profiles`) in the Bug Summary toolbar; selecting another user calls `GET /bugs/summary?target_zuid=&target_name=` so the admin sees that user's own Bug Summary. Editing a bug from this view is strictly owner-only (no Admin override) — viewing someone else's summary never grants edit rights over their bugs.
- Bug Summary includes the provided Excel workbook history plus fixed Data Store bugs.
- Live tracker lists never use browser fallback records; current bugs come from Data Store.
- All-bugs pagination is ten bugs per page.
- Active timer state survives reload and duplicated tabs through persisted DebugSessions timing.
- Timers support pause and resume.
- Completing a bug stores duration, category, notes, optional assigned user, and CRM-derived metadata.
- **Automatic bug closing is active (resumed 2026-10-28).** When a tracked bug is closed in CRM, the CRM `Bugs.edit` webhook closes the matching INVESTIGATING (or paused) centTrace bug, ends its running session, stores the total duration and category, and sets `verified_date`. `holdCrmAutoCompletion` in `handler.js` is the master switch; setting it to `true` stops all webhook completions (the bug then only gets title, feature, Failure ID, milestone, and release metadata refreshed and closes through the Finish form, `/bugs/complete`). Manual closing through the Finish form remains available. Bugs closed manually or by the webhook can have their category and assignee edited from the Bug details dialog. Automatic closing depends on the deployed function, the `CRM_NOTIFICATION_*` environment variables, and a live seven-day CRM subscription that an Admin renews through `POST /crm/notifications/subscribe`.
- CRM edit notifications close active centTrace timers according to this priority: a NEW CASE BREAKAGE subject, a MissedRows subject, a ZeroRows subject, a Product Issue in the CRM Bug Tracking rows, CRM closure outcome, Release Build Bugs layout, then open-bug owner transfer. A bug whose CRM subject contains "new case" always closes as `NEW_CASE Bug` in centTrace, overriding any other CRM transition (Fixed/Automation Changeset, Account Specific, Not Reproducible, Product Issue, Release Build layout, or owner transfer) that would otherwise complete it; it gets no assignee and writes no `AutomationChangesets` row. The same override applies to a bug whose CRM subject contains "missed rows" (`/missed[ _-]*rows/i`): it always closes as `MissedRows` in centTrace regardless of which CRM transition completes it (Fixed/Automation Changeset, Account Specific, Not Reproducible, Product Issue, Release Build layout, or owner transfer), taking priority immediately after the NEW_CASE check. The same override applies again to a bug whose CRM subject contains "zero rows" (`/zero[ _-]*rows/i`): it always closes as `ZeroRows` in centTrace regardless of which CRM transition completes it, taking priority immediately after the MissedRows check (previously `ZeroRows` was only a low-priority fallback used when the bug closed with no other recognized outcome; it is now resolved the same way as NEW_CASE/MissedRows, independent of the specific CRM transition). The tracked `Bugs`/`CustomModule2` CRM module has no top-level `Status` field (it is always blank); the closure outcome and the Product Issue/terminal state are primarily read from the actual latest `Bug_Tracking` subform row's own `Automation_Status`, falling back to the top-level `Automation_Bug_Status` field only if no tracking row carries a status. The "latest" tracking row is picked by each row's own `Modified_Time`/`Created_Time` **only when at least two rows actually carry genuinely different real timestamps**; in practice CRM sometimes stamps the exact same "last touched" timestamp onto every Bug_Tracking row for a record (observed: all 4 rows of a Fixed → Reopen → Fixed → Open chain sharing one identical instant, carrying zero ordering signal), in which case date comparison is useless and the latest row is instead taken as the **first row in CRM's own subform order** — this subform returns rows newest-first, confirmed by comparing the derived category against the record's actual current CRM state via the `GET /crm/bugs/:id/debug-tracking` diagnostic (Admin-only; also exposed as the "Debug CRM tracking" box on the Profiles page) — so trusting index 0 as the latest transition is correct whenever timestamps can't differentiate the rows. This is deliberate: CRM's own workflow that is supposed to mirror the latest tracking row's status onto the top-level field can silently fail to fire (observed with a bug marked Fixed in its tracking row whose top-level field stayed stale), so centTrace reads the tracking rows directly rather than trusting that mirror alone, same as `record.subforms.Bug_Tracking`, which CRM v8 returns nested there. Subform rows are also filtered to the notified record's own `Parent_Id`, since CRM can bundle tracking rows belonging to other, previously-merged bug records in the same subform payload. The completion timestamp saved to the session and bug uses the webhook notification's own `server_time` (the moment CRM detected the edit), falling back to the record's top-level `Modified_Time`, then the current time; it does **not** use a Bug Tracking row's `Modified_Time`, because that row can still be populating its own `Automation_Bug_Status` a few seconds after the webhook fires, so reading it immediately risks picking up a stale/earlier row instead of the just-made transition. If that completion time would predate the bug's running debug session's own `started_at` (e.g. legacy/stale CRM data), the webhook clamps it to the current time instead, so elapsed/"Time Taken" is never silently zeroed out by a negative duration. A Bug Tracking row whose Automation Bug Status is "Product Issue" or "Map Existing Product Bug" is treated identically and takes precedence over an owner change; reporters named Gokulraj R, Vikash A, or Balakrishnan K use `PI_Filed_via_Prediction`, while any other reporter uses `PI_FiledBy_RT` and is saved as the assignee. An open owner transfer otherwise uses `ChangedToAnotherAD` and assigns the new CRM owner — but a Release Build Bugs layout always takes priority over an owner transfer: if the bug's current `Layout` is "Release Build Bugs", the reporter-based `PI_Filed_via_Prediction`/`PI_FiledBy_RT` mapping is used instead of `ChangedToAnotherAD`, even when this specific CRM notification only changed the owner (not the layout field itself). This check is based on the record's current Layout value, not on whether Layout was one of the fields this notification changed, since an owner-only edit on an already-Release-Build-Bugs record must never fall through to `ChangedToAnotherAD`. A closed bug whose Automation Bug Status is Fixed uses `AutomationCodeFix` for a new Automation Changeset or for any bug closed with that same changeset on the same India-calendar day as its first use; otherwise (any bug, including the original one reopened, on a later day) it uses `AlreadyFixed_AI`. A closed bug whose Automation Bug Status is "Dependency Service" uses `OtherDependencyIssues` and stores CRM's `Dependency_Service_Name` field value in the bug's own `dependency_service_name` column (not `assigned_user_name`, which stays unset/unchanged for this category).
- Open centTrace pages refresh their own Data Store state every 30 seconds and when the tab becomes visible; these refreshes do not poll CRM.
- Assignment is shown only for `PI_FiledBy_RT`, `ChangedToAnotherAD`, and `AssignedByAD`.
- The CRM user selector supports search, arrow keys, Enter, and displays name/email while selecting.
- Bug Summary provides Day, Week, and Month navigation with personal metrics, date activity, feature and category breakdowns, and a filterable bug-detail list. Feature and category cards are fixed-height and internally scrollable. Selecting a feature narrows the Category breakdown to only categories seen on that feature's bugs (and vice versa); clearing the filter restores both breakdowns to the full period.
- Selecting the `OtherDependencyIssues` category in Bug Summary's Category breakdown reveals a donut "Dependency breakdown" chart (above the bug list) that groups the filtered bugs by their stored `dependency_service_name`, with a color-coded legend (count + percentage per dependency). Selecting the `PI_FiledBy_RT` category instead reveals a "Reporter breakdown" donut grouping by `assigned_user_name` (the stored reporter). Both charts share the same component; clicking a legend row further narrows the bug-detail list to bugs in that category with that specific value, and the chart stays visible while drilling into a single slice, disappearing once the category filter is cleared or changed.
- Custom dropdowns use one scrollable results region and close when the user clicks outside, presses Escape, changes views, or closes a dialog.
- Time Chart is user selectable for Admin, week navigable from September 2026 to the current week, and displays daily bugs sorted by descending duration.
- Time Chart shows total time and average time per completed bug for the week and selected day.
- Elapsed/"Time taken" durations are formatted consistently everywhere (Today's dashboard, Time Chart, Bug Summary): `Xh Ym` once an hour is reached, otherwise `Xm Ys`, or just `Xs` under a minute.
- Bug rows open a shared detail dialog from Today, Bug Summary, Time Chart, and Unstabilized Cases. For a closed (Fixed) bug stored in Data Store, only its real owner sees "Edit category & assignee" in the dialog — Admin can view every owner's bug details but cannot edit them; there is no Admin override here, on purpose (viewing is Admin-wide, modifying is owner-only). The category can be changed to any category in the Finish form list, and the assigned user can be any CRM user (`GET /users`, Admin-only, so non-Admin owners can only keep the current assignee or choose Unassigned) or Unassigned, regardless of category. Saving calls `POST /bugs/classification`, which verifies the bug is FIXED and that the caller is the stored `owner_zuid` (via `isStoredBugOwner`), updates only `category`, `assigned_user_name`, and `assigned_user_zuid`, and then reloads the tracker data. Imported workbook history is not editable. The same owner-only rule (no Admin bypass) applies to pausing/resuming/finishing a debugging timer (`/bugs/pause`, `/bugs/resume`, `/bugs/complete`) and to deleting a bug closed today (`DELETE /bugs/:rowId`); Admin's broader visibility across these pages never grants write access to another owner's bug. (Long Pending Issue owner reassignment, by contrast, is intentionally Admin-only — that is a distinct, explicitly requested feature, not a general Admin override.)
- Duplicate Failure IDs offer a confirmation before adding/updating Long Pending Bugs.
- The duplicate Failure ID confirmation embeds the existing Long Pending bug, its metadata, recent findings, and actions to open the saved bug or view/add logs.
- Long Pending records are grouped by feature and store owner, current bug link, breakage, and findings logs.
- The Long Pending Issues view shows a two-level drill-down: a compact grid of feature cards (name + issue count only), sorted by total issue count descending (busiest features first); clicking a card (`#long-pending-issues/feature/<name>`) opens that feature's own issue list, sorted by descending occurrence count, with a back link to the feature grid. This avoids cramming every feature's full issue list on screen at once.
- Occurrence counting bypasses ZCQL entirely: `/long-pending` reads every Bugs row via `readAllRows(bugs)` (the Data Store iterable-row API, same pattern as `/bugs/summary`) and tallies matches per `failure_id` in memory, then matches ownership with `isStoredBugOwner`. ZCQL was dropped here because it rejects `SELECT`s on the primary Data Store without a `WHERE` clause and because pre-migration rows carry a stale `owner_zuid`, both of which previously caused the occurrence count to silently stay at `1`.
- Deleting a completed Long Pending bug can also remove LongPendingBugs and LongPendingLogs records after confirmation.
- The Long Pending Issues occurrence detail view (`#long-pending-issues/:failureId`) supports removing a Failure ID entirely (`DELETE /long-pending/:failureId`, available to the issue's owner or any Admin; also deletes its LongPendingLogs findings) and reassigning its owner (`PATCH /long-pending/:failureId/owner`, Admin-only, picking from the Catalyst project user directory already used for the Bug Summary user picker via `GET /profiles`). Reassignment also writes a LongPendingLogs finding ("Owner changed from X to Y"), visible via View/Add Logs, so both the previous and new owner can see the assignment changed (the log's own owner_name metadata records who made the change).
- Today's bug list (`#bugList` in `timer.js`) and the CRM Restriction page's bug list (`restriction.js`) both show a Category column. It displays the stored `category` only for a bug that is already closed (Today: `b.finishedAt` set; Restriction: the tracked bug's computed state is `'closed'`); otherwise it shows a hyphen (`—`), since category is only finalized at close time.
- Bugs whose CRM title contains NEW CASE BREAKAGE are shown in Unstabilized Cases, grouped by CRM Unique ID and feature.
- Restriction fetches every record from CRM custom view `1034369000840611390` with CRM page-token pagination (up to the API limit of 100,000 records), then matches Bug Owner to the authenticated user by CRM user ID, email, or normalized name. Finishing a Restriction timer changes that exact CRM record to Closed immediately and keeps it Closed after reload for the rest of the India calendar day. A completion with an assigned user represents a finished handoff such as `ChangedToAnotherAD` and remains Closed beyond that day. Older ordinary completion history does not prevent a CRM-open bug from being started again. Investigating and paused Restriction bugs persisted in Data Store are merged into the live CRM result so they remain visible after reload even if CRM no longer returns them. The owner-specific result is paginated at ten records per page. A row moves through Start debugging, Pause/Resume, and Finish debugging without navigating away from Restriction. Starting a Restriction bug opens CRM in a new tab only after its timer is successfully created, while finishing opens CRM after the result is saved. CRM batch counts, record IDs, pagination tokens, duplicate IDs, owner resolution, and the client/server owner count are checked so an incomplete list fails visibly instead of appearing valid.
- Today captures the authenticated user's Restriction bug count for each India calendar day and shows a top-level pie chart with the percentage completed that day. The per-user daily baseline is stored in browser local storage and self-heals as the union of its existing rows, the current CRM Restriction rows, and Restriction bugs completed that day. This prevents a transient empty CRM result from permanently saving `0 closed / 0 remaining / 0 total`, and the baseline still does not shrink as CRM removes completed bugs from the live custom view. If centTrace remains open across 12:00 AM Asia/Kolkata, it clears the previous in-memory daily list, returns the progress card to its loading state, and fetches the CRM Restriction view again before initializing the new day's baseline.
- Stabilizing a Unique ID requires confirmation and server-side ownership verification; only the authenticated owner of the source bug can perform it. Stabilized cases move to a separate tab and remain available for review.
- Stabilization ownership accepts either the persisted Catalyst user identifier or an exact normalized owner-name match. The name fallback is required for Bugs migrated between Catalyst projects because project-specific user identifiers can change while the authenticated user's display name remains the same.
- StabilizedCases and Bug Summary reads use the Data Store iterable-row API, which follows Catalyst pagination without exceeding the 300-row page limit. A configured but empty StabilizedCases table returns an empty list instead of being reported as missing.

## Historical workbook

`Complete Bug Analysis.xlsx` supplies historical analytics records. Imported workbook rows are stored in browser local storage and used only by Bug Summary. They are marked `imported` and never appear as live tracker timers.

## Active Catalyst project

- Account: `vishwa.sr@zohocorp.com`
- Organization and Development environment ID: `60047414473`
- Project: `centtrace` (`20463000006264093`)
- App: `https://centtrace-60047414473.development.catalystserverless.in/app/`

The workspace `.catalystrc` actively targets this project. The previous Development project was `CentTrace` (`35915000000062033`) in organization/environment `60070076632`; do not deploy current code there. The new project requires its own Embedded Authentication configuration, Public Signup setting, users, CRM connections, function environment variables, Security Rules, and CRM notification subscription because these project resources do not move with source code. Data Store schemas and migrated rows live in the new project. Migration utilities and exports in `scripts/` and `migration/` are retained as historical/recovery artifacts and are not part of the normal deployment flow.

The Development Data Store migration completed on 2026-10-14 from the previous project to the active project. The imported counts were Bugs 446, DebugSessions 534, LongPendingBugs 23, LongPendingLogs 1, and UserProfiles 5, with zero rejected rows. StabilizedCases and AutomationChangesets were empty in the source and remain empty. Catalyst generated new Bugs ROWIDs during import, so the migration utility matched each imported Bug by its complete application-data fingerprint and rewrote every DebugSessions `bug_id` before importing the sessions. The source snapshot is in `migration/snapshots/2026-10-14-old/`; the post-import Bugs export used for ROWID mapping is in `migration/snapshots/2026-10-14-new-after-bugs/`.

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
catalyst --org 60047414473 project:list
catalyst --org 60047414473 deploy
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
