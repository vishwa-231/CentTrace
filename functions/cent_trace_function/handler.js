'use strict';

const catalyst = require('zcatalyst-sdk-node');

const readBody = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch (error) {
      reject(error);
    }
  });
  req.on('error', reject);
});

const send = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache'
  });
  res.end(JSON.stringify(data));
};

const bugColumns = [
  'ROWID', 'bug_link', 'bug_title', 'milestone', 'release_type', 'category',
  'feature', 'owner_zuid', 'owner_name', 'status', 'verified_date',
  'total_elapsed_seconds', 'notes', 'assigned_user_name', 'assigned_user_zuid', 'dependency_service_name', 'failure_id', 'source', 'is_archived', 'CREATEDTIME'
].join(', ');

const longPendingColumns = [
  'ROWID', 'failure_id', 'feature_name', 'breakage', 'bug_link', 'bug_title', 'owner_name', 'CREATEDTIME'
].join(', ');

const longPendingLogColumns = [
  'ROWID', 'failure_id', 'finding', 'owner_name', 'bug_link', 'CREATEDTIME'
].join(', ');

const profileColumns = ['ROWID', 'user_zuid', 'user_name', 'email', 'role', 'is_active', 'CREATEDTIME'].join(', ');

const sessionColumns = [
  'ROWID', 'bug_id', 'started_at', 'ended_at', 'elapsed_seconds',
  'session_status', 'started_by_zuid', 'started_by_name', 'CREATEDTIME'
].join(', ');

const catalystDateTime = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};
const zcqlValue = value => String(value || '').replace(/'/g, "\\'");
const readAllRows = async table => {
  const rows = [];
  for await (const row of table.getIterableRows()) rows.push(row);
  return rows;
};

const resolveUserName = user => {
  if (!user) return 'Catalyst user';
  const nameParts = [
    user.full_name,
    user.display_name,
    user.name,
    [user.first_name, user.last_name].filter(Boolean).join(' '),
    user.first_name,
    user.last_name,
    user.email_id
  ].filter(value => typeof value === 'string' && value.trim());
  return nameParts[0] || 'Catalyst user';
};

const normalizedIdentity = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const isStoredBugOwner = (bug, user) => {
  const storedOwnerId = String(bug?.owner_zuid || '').trim();
  const currentUserIds = [user?.zuid, user?.user_id].map(value => String(value || '').trim()).filter(Boolean);
  if (storedOwnerId && currentUserIds.includes(storedOwnerId)) return true;
  const storedOwnerName = normalizedIdentity(bug?.owner_name);
  return Boolean(storedOwnerName) && storedOwnerName === normalizedIdentity(resolveUserName(user));
};

const crmConnectionLinkName = 'crm_bug_lookup';
const crmUsersConnectionLinkName = 'crm_org_users';
const crmApiBase = 'https://www.zohoapis.in/crm/v8';
const crmLegacyApiBase = 'https://www.zohoapis.in/crm/v2.2';
const restrictionCustomViewId = '1034369000840611390';
const restrictionCustomViewUrl = `https://crm.zoho.in/crm/crmlaunchpad/tab/CustomModule2/custom-view/${restrictionCustomViewId}/list`;
const uncategorized = 'Uncategorized';
const userEmail = user => String(user?.email_id || user?.email || '').trim().toLowerCase();
const normalizedCrmKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const crmField = (record, ...names) => {
  for (const name of names) {
    const value = record?.[name];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  const requestedKeys = new Set(names.map(normalizedCrmKey));
  const acceptsNumberedUniqueId = requestedKeys.has('uniqueid');
  for (const [key, value] of Object.entries(record || {})) {
    if (value === undefined || value === null || !String(value).trim()) continue;
    const normalizedKey = normalizedCrmKey(key);
    if (requestedKeys.has(normalizedKey) || (acceptsNumberedUniqueId && /^uniqueid\d+$/.test(normalizedKey))) {
      return value;
    }
  }
  return '';
};
const crmBugSummary = (record, fallbackId = '') => ({
  id: String(record?.id || fallbackId),
  unique_id: String(crmField(record, 'Unique_ID', 'UniqueID', 'Unique_Id')),
  feature_name: crmField(record, 'Feature_Name', 'FeatureName') || '',
  name: crmField(record, 'Name') || ''
});
const crmValueText = value => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return String(value.name || value.full_name || value.display_value || value.id || '').trim();
  return String(value).trim();
};
const crmRecordIdFromLink = value => String(value || '').match(/\/(?:Bugs|CustomModule2)\/(\d+)(?:[/?#]|$)/i)?.[1]
  || String(value || '').match(/\/crm\/v2\.2\/Bugs\/(\d+)(?:[/?#]|$)/i)?.[1]
  || '';
const indiaDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
const crmMilestoneAndRelease = record => {
  const reportName = crmValueText(crmField(record, 'Report_Name', 'ReportName'));
  const subject = crmValueText(crmField(record, 'Name'));
  const standardMatch = reportName.match(/(?:^|_)TB(\d+)_([A-Z]{2,5})(?:_|$)/i);
  if (standardMatch) return { milestone: standardMatch[1], release: standardMatch[2].toUpperCase() };
  const isHbBug = /Latest_Default/i.test(reportName) || /(?:^|_)HB(?:_|\b)/i.test(subject);
  if (!isHbBug) return null;
  const milestone = subject.match(/TB(\d+)_HB(?:_|\b)/i)?.[1]
    || reportName.match(/Latest_Default_(\d+)(?:_|\b)/i)?.[1];
  return milestone ? { milestone, release: 'HB' } : null;
};
const normalizedCategoryValue = value => crmValueText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const predictionReporters = new Set(['gokulrajr', 'vikasha', 'balakrishnank']);
// Master switch for automatic bug closing. The CRM webhook is the only automatic
// completion path. While false, a CRM edit notification closes the tracked
// centTrace bug (CRM closure, Product Issue, layout change, or owner transfer).
// Set to true to stop automatic closing; bugs then close only through the manual
// Finish form (/bugs/complete).
const holdCrmAutoCompletion = false;
const crmIndiaDateTime = value => {
  const indiaOffsetMs = 330 * 60 * 1000;
  return `${new Date(value.getTime() + indiaOffsetMs).toISOString().slice(0, 19)}+05:30`;
};
const notificationChangedFields = (body, recordId) => {
  const entries = Array.isArray(body?.affected_fields) ? body.affected_fields : [];
  const fields = entries.flatMap(entry => Object.entries(entry || {}))
    .filter(([id]) => !recordId || String(id) === String(recordId))
    .flatMap(([, names]) => Array.isArray(names) ? names : []);
  return new Set(fields.map(normalizedCrmKey));
};
const automationTrackingRows = (record, recordId) => [
  ...Object.values(record || {}),
  ...Object.values(record?.subforms || {})
]
  .filter(Array.isArray)
  .flat()
  .filter(row => row && typeof row === 'object' && crmField(
    row,
    'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus'
  ))
  // CRM can bundle tracking rows for other, previously-merged bug records under
  // the same subform payload. Keep only rows that belong to this exact record,
  // so an older bug's transition/date never gets mistaken for this one's.
  .filter(row => {
    const parentId = crmField(row, 'Parent_Id', 'ParentId');
    const parentIdText = typeof parentId === 'object' ? String(parentId?.id || '') : String(parentId || '');
    return !parentIdText || !recordId || parentIdText === String(recordId);
  });
const fetchCrmBugRecord = async (connection, recordId) => {
  let lastError = { status: 502, message: 'Unable to retrieve the CRM bug record.' };
  for (const apiBase of [crmApiBase, crmLegacyApiBase]) {
    const crmResponse = await fetch(`${apiBase}/Bugs/${recordId}`, {
      headers: { ...connection.headers, Accept: 'application/json' }
    });
    const crmBody = crmResponse.status === 204 ? {} : await crmResponse.json().catch(() => ({}));
    const record = crmBody.data?.[0];
    if (crmResponse.ok && record) return record;
    lastError = {
      status: crmResponse.status || 502,
      message: crmBody.message || (crmResponse.status === 404 || crmResponse.status === 204
        ? 'CRM bug record was not found.'
        : 'Unable to retrieve the CRM bug record.')
    };
    if (![404, 500, 502, 503, 504].includes(crmResponse.status)) break;
  }
  const error = new Error(lastError.message);
  error.status = lastError.status;
  throw error;
};

// Zoho CRM's "watch" subscription silently expires after a few days of its
// own channel_expiry (capped at CRM's 7-day maximum below) with no automatic
// renewal on CRM's side; once it lapses, CRM simply stops sending edit
// notifications at all, so bugs can stay stuck "In Progress" in centTrace no
// matter how many times they're actually closed in CRM. Re-issuing this same
// watch call is idempotent (it just extends the existing channel's expiry),
// so every real webhook delivery is used as an opportunity to push the
// expiry further out, keeping the subscription alive indefinitely as long as
// CRM edits keep happening.
const renewCrmWatchSubscription = async connection => {
  const notifyUrl = String(process.env.CRM_NOTIFICATION_URL || '').trim();
  const token = String(process.env.CRM_NOTIFICATION_TOKEN || '').trim();
  const channelId = String(process.env.CRM_NOTIFICATION_CHANNEL_ID || '').trim();
  if (!/^https:\/\//i.test(notifyUrl) || !token || !/^\d+$/.test(channelId)) return null;
  const expiry = crmIndiaDateTime(new Date(Date.now() + ((6 * 24 + 23) * 60 * 60 * 1000)));
  const crmResponse = await fetch(`${crmApiBase}/actions/watch`, {
    method: 'POST',
    headers: { ...connection.headers, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      watch: [{
        channel_id: channelId,
        events: ['Bugs.edit'],
        channel_expiry: expiry,
        notify_url: notifyUrl,
        token,
        return_affected_field_values: true
      }]
    })
  });
  const crmBody = await crmResponse.json().catch(() => ({}));
  const subscription = crmBody.watch?.[0];
  if (!crmResponse.ok || String(subscription?.status || '').toLowerCase() !== 'success') {
    const error = new Error(subscription?.message || crmBody.message || 'CRM notification subscription could not be enabled.');
    error.status = crmResponse.status || 502;
    error.crmBody = crmBody;
    throw error;
  }
  return { subscribed: true, expires_at: expiry, crm_response: crmBody };
};

const processCrmNotification = async ({ app, dataApp, body }) => {
  const configuredToken = String(process.env.CRM_NOTIFICATION_TOKEN || '').trim();
  if (!configuredToken) return { status: 503, body: { error: 'CRM_NOTIFICATION_TOKEN is not configured.' } };
  if (String(body?.token || '').trim() !== configuredToken) {
    return { status: 401, body: { error: 'The CRM notification token is invalid.' } };
  }

  // Every genuine webhook delivery proves the subscription is still alive -
  // use it to push the channel's expiry further out so it never silently
  // lapses again. Best-effort: a renewal hiccup must never block processing
  // this notification's actual bug updates below.
  try {
    const renewConnection = await app.connections().getConnectionCredentials(crmConnectionLinkName);
    await renewCrmWatchSubscription(renewConnection);
  } catch (error) { /* ignore - renewal retries on the next notification */ }

  const notificationIds = [...new Set([
    ...(Array.isArray(body?.ids) ? body.ids : []),
    ...(Array.isArray(body?.affected_values) ? body.affected_values.map(value => value?.record_id) : [])
  ].map(value => String(value || '').trim()).filter(value => /^\d+$/.test(value)))];
  if (!notificationIds.length) return { status: 200, body: { processed: 0, completed: 0 } };

  const bugTable = dataApp.datastore().table('Bugs');
  const sessionTable = dataApp.datastore().table('DebugSessions');
  const changesetTable = dataApp.datastore().table('AutomationChangesets');
  const stored = await dataApp.zcql().executeZCQLQuery(
    `SELECT ${bugColumns} FROM Bugs WHERE status = 'INVESTIGATING' AND is_archived = false LIMIT 200`
  );
  const activeByCrmId = new Map();
  for (const value of stored) {
    const bug = value.Bugs || value;
    const crmId = crmRecordIdFromLink(bug.bug_link);
    if (notificationIds.includes(crmId)) activeByCrmId.set(crmId, [...(activeByCrmId.get(crmId) || []), bug]);
  }
  if (!activeByCrmId.size) return { status: 200, body: { processed: 0, completed: 0 } };

  const connection = await app.connections().getConnectionCredentials(crmConnectionLinkName);
  let completed = 0;
  let updated = 0;
  const results = [];
  for (const [recordId, trackedBugs] of activeByCrmId) {
    const record = await fetchCrmBugRecord(connection, recordId);
    const changedFields = notificationChangedFields(body, recordId);
    const subject = crmValueText(crmField(record, 'Name'));
    const feature = crmValueText(crmField(record, 'Feature_Name', 'FeatureName'));
    const failureId = crmValueText(crmField(record, 'FailureID', 'Failure_ID'));
    const crmStatus = normalizedCategoryValue(crmField(record, 'Status', 'Bug_Status', 'BugStatus'));
    const trackingRows = automationTrackingRows(record, recordId);
    // CRM is supposed to mirror the latest Bug_Tracking row's own status onto
    // the top-level Automation_Bug_Status field, but that mirror can silently
    // fail to update (e.g. a bug marked Fixed in its tracking row stays
    // "Open"/blank at the top level). Read the actual latest tracking row's
    // own status directly and prefer it over the possibly-stale top-level
    // field, so a real CRM transition is never missed.
    // Bug_Tracking subform rows can have a Modified_Time, but CRM sometimes
    // stamps the exact same timestamp on every row in the subform (observed:
    // all 4 rows of a Fixed -> Reopen -> Fixed -> Open chain sharing one
    // identical "last touched" instant, carrying zero ordering signal), not
    // each row's own distinct edit time. When that happens, trust CRM's own
    // row order instead: this subform returns rows NEWEST-FIRST (confirmed by
    // comparing the derived category against the record's actual current
    // CRM state), so the first row is the latest transition unless at least
    // two rows carry genuinely different real timestamps to sort by.
    const trackingRowTime = row => Date.parse(crmValueText(crmField(row, 'Modified_Time', 'Created_Time'))) || 0;
    const trackingRowsHaveDistinctTimes = new Set(trackingRows.map(trackingRowTime).filter(time => time > 0)).size > 1;
    const latestTrackingRow = trackingRows.length
      ? (trackingRowsHaveDistinctTimes
        ? [...trackingRows].sort((rowA, rowB) => trackingRowTime(rowB) - trackingRowTime(rowA))[0]
        : trackingRows[0])
      : null;
    const automationStatus = normalizedCategoryValue(crmField(
      latestTrackingRow,
      'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus'
    )) || normalizedCategoryValue(crmField(
      record,
      'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus'
    ));
    // "Map Existing Product Bug" is treated the same as "Product Issue": both
    // route through the reporter-based PI_Filed_via_Prediction / PI_FiledBy_RT mapping.
    const productIssueTrackingRow = trackingRows.find(row => ['productissue', 'mapexistingproductbug'].includes(normalizedCategoryValue(crmField(
      row,
      'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus'
    ))));
    const layout = crmValueText(crmField(record, '$layout', 'Layout', 'Layout_Name', 'LayoutName'));
    const reporterValue = crmField(
      productIssueTrackingRow,
      'Automation_Bug_Reporter', 'AutomationBugReporter', 'Automation_Reporter', 'AutomationReporter'
    ) || crmField(
      record,
      'Automation_Bug_Reporter', 'AutomationBugReporter', 'Automation_Reporter', 'AutomationReporter'
    );
    const reporterName = crmValueText(reporterValue);
    const reporterId = typeof reporterValue === 'object' ? String(reporterValue.id || '') : '';
    const ownerValue = crmField(record, 'Owner', 'Bug_Owner', 'BugOwner');
    const ownerName = crmValueText(ownerValue);
    const ownerId = typeof ownerValue === 'object' ? String(ownerValue.id || '') : '';
    // This CRM module has no top-level Status field; the terminal outcome comes
    // from Automation_Bug_Status (mirrors the latest Bug_Tracking row below).
    const terminalOutcome = automationStatus || crmStatus;
    const closed = ['closed', 'fixed', 'resolved', 'notreproducibleai', 'notreproai', 'notreproduciblepi', 'notrepropi', 'accountspecificissue', 'accountspecific', 'dependencyservice', 'aalamissue', 'aalamsissue'].includes(terminalOutcome)
      || terminalOutcome.startsWith('closed');
    const layoutChanged = [...changedFields].some(field => field === 'layout' || field === 'layoutname');
    const ownerChanged = [...changedFields].some(field => field === 'owner' || field === 'bugowner');
    const isReleaseBuild = normalizedCategoryValue(layout) === 'releasebuildbugs';
    const reporterUsesPrediction = predictionReporters.has(normalizedCategoryValue(reporterName));
    const milestoneAndRelease = crmMilestoneAndRelease(record);
    // A NEW CASE BREAKAGE bug always closes as NEW_CASE Bug in centTrace, regardless
    // of the CRM transition (Fixed, Account Specific, Not Reproducible, Product
    // Issue, layout change, or owner transfer) that completes it.
    const isNewCaseBug = /new[ _-]*case/i.test(subject);
    // A MissedRows bug is categorized the same way, regardless of the CRM
    // transition that completes it.
    const isMissedRowsBug = /missed[ _-]*rows/i.test(subject);
    // A ZeroRows bug is categorized the same way too, regardless of the CRM
    // transition (Fixed, Account Specific, Not Reproducible, Product Issue,
    // layout change, or owner transfer) that completes it.
    const isZeroRowsBug = /zero[ _-]*rows/i.test(subject);
    // Bug_Tracking subform rows can lag slightly behind the webhook delivery:
    // CRM may send the edit notification before the new tracking row's own
    // Automation_Bug_Status field has finished populating, so re-fetching the
    // record right away can still see the previous row as "latest". Use the
    // webhook's own delivery time (the moment CRM detected the edit) instead,
    // which is unaffected by that propagation lag.
    const completionMillis = Number(body.server_time)
      || Date.parse(crmValueText(crmField(record, 'Modified_Time')))
      || Date.now();

    let category = '';
    let assignedUserName = '';
    let assignedUserZuid = '';
    let automationChangeset = '';
    let dependencyServiceName = '';
    if (holdCrmAutoCompletion) {
      // The bug stays INVESTIGATING; only its CRM metadata is refreshed below.
    } else if (isNewCaseBug && (productIssueTrackingRow || closed || (layoutChanged && isReleaseBuild) || ownerChanged)) {
      category = 'NEW_CASE Bug';
    } else if (isMissedRowsBug && (productIssueTrackingRow || closed || (layoutChanged && isReleaseBuild) || ownerChanged)) {
      category = 'MissedRows';
    } else if (isZeroRowsBug && (productIssueTrackingRow || closed || (layoutChanged && isReleaseBuild) || ownerChanged)) {
      category = 'ZeroRows';
    } else if (productIssueTrackingRow) {
      category = reporterUsesPrediction ? 'PI_Filed_via_Prediction' : 'PI_FiledBy_RT';
      if (!reporterUsesPrediction) {
        assignedUserName = reporterName;
        assignedUserZuid = reporterId;
      }
    } else if (closed) {
      if (['notreproducibleai', 'notreproai'].includes(terminalOutcome)) category = 'NotReproducibleAI';
      else if (['notreproduciblepi', 'notrepropi'].includes(terminalOutcome)) category = 'NotReproduciblePI';
      else if (['accountspecificissue', 'accountspecific'].includes(terminalOutcome)) category = 'Account Specific Issue';
      else if (['aalamissue', 'aalamsissue'].includes(terminalOutcome)) category = 'AalamsIssue';
      else if (terminalOutcome === 'dependencyservice') {
        category = 'OtherDependencyIssues';
        // Stored in its own Bugs column (not assigned_user_name, which is
        // reserved for the reassigned/reporting user) so it doesn't get
        // confused with bug assignment.
        dependencyServiceName = crmValueText(crmField(record, 'Dependency_Service_Name'));
      }
      else if (automationStatus === 'fixed') {
        automationChangeset = crmValueText(crmField(
          record,
          'Automation_Changeset', 'AutomationChangeset', 'Automation_Change_Set', 'Automation_Changeset_URL'
        ));
        if (automationChangeset) {
          // First use of a changeset, and any bug (including the same one, if
          // reopened) fixed with the same changeset on that same India-calendar
          // day, counts as AutomationCodeFix. From the next day onward, any bug
          // closed with that changeset is AlreadyFixed_AI, permanently.
          const todayIndia = indiaDate(completionMillis);
          const classifyChangeset = existingChangeset => {
            const firstUsedIndia = indiaDate(Date.parse(`${String(existingChangeset.CREATEDTIME || '').replace(' ', 'T')}Z`));
            return firstUsedIndia === todayIndia ? 'AutomationCodeFix' : 'AlreadyFixed_AI';
          };
          const existing = await dataApp.zcql().executeZCQLQuery(
            `SELECT ROWID, bug_url, CREATEDTIME FROM AutomationChangesets WHERE automation_changeset = '${zcqlValue(automationChangeset)}' LIMIT 1`
          );
          const existingChangeset = existing[0] && (existing[0].AutomationChangesets || existing[0]);
          if (existingChangeset) {
            category = classifyChangeset(existingChangeset);
          }
          else {
            try {
              await changesetTable.insertRow({ bug_url: trackedBugs[0].bug_link || '', automation_changeset: automationChangeset });
              category = 'AutomationCodeFix';
            } catch (error) {
              const raced = await dataApp.zcql().executeZCQLQuery(
                `SELECT ROWID, bug_url, CREATEDTIME FROM AutomationChangesets WHERE automation_changeset = '${zcqlValue(automationChangeset)}' LIMIT 1`
              );
              if (!raced.length) throw error;
              const racedChangeset = raced[0].AutomationChangesets || raced[0];
              category = classifyChangeset(racedChangeset);
            }
          }
        } else category = 'AutomationCodeFix';
      } else if (isReleaseBuild) {
        category = reporterUsesPrediction ? 'PI_Filed_via_Prediction' : 'PI_FiledBy_RT';
        if (!reporterUsesPrediction) {
          assignedUserName = reporterName;
          assignedUserZuid = reporterId;
        }
      } else category = uncategorized;
    } else if (isReleaseBuild) {
      // A Release Build Bugs layout always uses the reporter-based Product
      // Issue mapping, even when the only thing this notification changed
      // was the owner (not the layout field itself) - the owner-transfer
      // rule below must never override a Release Build Bugs record.
      category = reporterUsesPrediction ? 'PI_Filed_via_Prediction' : 'PI_FiledBy_RT';
      if (!reporterUsesPrediction) {
        assignedUserName = reporterName;
        assignedUserZuid = reporterId;
      }
    } else if (ownerChanged) {
      category = 'ChangedToAnotherAD';
      assignedUserName = ownerName;
      assignedUserZuid = ownerId;
    }

    for (const trackedBug of trackedBugs) {
      const metadataUpdate = {
        ROWID: trackedBug.ROWID,
        ...(subject ? { bug_title: subject } : {}),
        ...(feature ? { feature } : {}),
        ...(failureId ? { failure_id: failureId } : {}),
        ...(milestoneAndRelease ? { milestone: milestoneAndRelease.milestone, release_type: milestoneAndRelease.release } : {})
      };
      if (!category) {
        await bugTable.updateRow(metadataUpdate);
        updated += 1;
        continue;
      }

      const sessionRows = await dataApp.zcql().executeZCQLQuery(
        `SELECT ${sessionColumns} FROM DebugSessions WHERE bug_id = ${trackedBug.ROWID} ORDER BY CREATEDTIME ASC`
      );
      const storedSessions = sessionRows.map(value => value.DebugSessions || value);
      const runningSession = storedSessions.find(session => String(session.session_status || '').toUpperCase() === 'RUNNING');
      // Guard against a completion time that predates this session's own start
      // (e.g. stale/legacy CRM data, clock skew). Without this, elapsed time
      // clamps to 0 via Math.max(0, negative) below, silently discarding the
      // real duration the bug was open for.
      const runningStartMillis = runningSession
        ? Date.parse(`${String(runningSession.started_at || '').replace(' ', 'T')}Z`)
        : null;
      const safeCompletionMillis = (Number.isFinite(runningStartMillis) && completionMillis < runningStartMillis)
        ? Date.now()
        : completionMillis;
      const endedAt = catalystDateTime(safeCompletionMillis);
      const elapsedBetween = (startValue, endValue) => {
        const start = new Date(`${String(startValue || '').replace(' ', 'T')}Z`).getTime();
        const end = new Date(`${String(endValue || '').replace(' ', 'T')}Z`).getTime();
        return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
      };
      const runningElapsed = runningSession ? elapsedBetween(runningSession.started_at, endedAt) : 0;
      const totalElapsed = storedSessions.reduce((total, session) => total + (
        runningSession && String(session.ROWID) === String(runningSession.ROWID)
          ? runningElapsed
          : Number(session.elapsed_seconds || 0)
      ), 0);
      if (runningSession?.ROWID) {
        await sessionTable.updateRow({
          ROWID: runningSession.ROWID,
          ended_at: endedAt,
          elapsed_seconds: runningElapsed,
          session_status: 'COMPLETED'
        });
      } else {
        await sessionTable.insertRow({
          bug_id: trackedBug.ROWID,
          started_at: endedAt,
          ended_at: endedAt,
          elapsed_seconds: 0,
          session_status: 'COMPLETED',
          started_by_zuid: trackedBug.owner_zuid || '',
          started_by_name: trackedBug.owner_name || ''
        });
      }
      await bugTable.updateRow({
        ...metadataUpdate,
        category,
        assigned_user_name: assignedUserName,
        assigned_user_zuid: assignedUserZuid,
        ...(dependencyServiceName ? { dependency_service_name: dependencyServiceName } : {}),
        status: 'FIXED',
        verified_date: indiaDate(safeCompletionMillis),
        total_elapsed_seconds: totalElapsed
      });
      completed += 1;
    }
    results.push({ record_id: recordId, category: category || null, tracked_bugs: trackedBugs.length });
  }
  return { status: 200, body: { processed: results.length, completed, updated, results } };
};

module.exports = async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    // Data Store operations use the function credential. The signed-in user
    // credential remains the source of identity, and every owner/profile
    // authorization check below is evaluated before a protected operation.
    const dataApp = catalyst.initialize(req, { scope: 'admin' });
    const requestUrl = new URL(req.url, 'http://localhost');
    const path = requestUrl.pathname;
    if (req.method === 'POST' && path === '/crm/notifications/webhook') {
      const body = await readBody(req);
      const result = await processCrmNotification({ app, dataApp, body });
      return send(res, result.status, result.body);
    }
    let currentUser = null;
    try {
      currentUser = await app.userManagement().getCurrentUser();
    } catch (_) {}
    if (!currentUser) return send(res, 401, { error: 'Sign in is required to use centTrace.' });
    const userProfiles = dataApp.datastore().table('UserProfiles');
    const currentZuid = String(currentUser.zuid || currentUser.user_id || '');
    let savedProfile = null;
    try {
      const saved = await dataApp.zcql().executeZCQLQuery(`SELECT ${profileColumns} FROM UserProfiles WHERE user_zuid = '${zcqlValue(currentZuid)}' LIMIT 1`);
      savedProfile = saved[0] && (saved[0].UserProfiles || saved[0]);
    } catch (_) {}
    const savedRole = String(savedProfile?.role || '').toUpperCase();
    // New users (no saved UserProfiles row yet) default to ADMIN rather than
    // STANDARD. An explicitly saved role always takes precedence, so an admin
    // can still downgrade a specific user to STANDARD afterward.
    const profile = { role: ['ADMIN', 'STANDARD'].includes(savedRole) ? savedRole : 'ADMIN' };
    const isAdmin = profile.role === 'ADMIN';
    const ownerFor = () => ({
      zuid: String(currentUser.zuid || currentUser.user_id || ''),
      name: resolveUserName(currentUser)
    });
    const bugs = dataApp.datastore().table('Bugs');
    const sessions = dataApp.datastore().table('DebugSessions');
    const longPendingBugs = dataApp.datastore().table('LongPendingBugs');
    const longPendingLogs = dataApp.datastore().table('LongPendingLogs');
    const stabilizedCases = dataApp.datastore().table('StabilizedCases');
    if (req.method === 'GET' && path === '/profiles') {
      if (!isAdmin) return send(res, 403, { error: 'Profile management is available to Admin profiles only.' });
      const [projectUsers, storedProfiles] = await Promise.all([
        app.userManagement().getAllUsers(),
        dataApp.zcql().executeZCQLQuery(`SELECT ${profileColumns} FROM UserProfiles`).catch(() => [])
      ]);
      const profilesByZuid = new Map(storedProfiles.map(record => record.UserProfiles || record).map(record => [String(record.user_zuid), record]));
      const users = projectUsers.map(user => {
        const zuid = String(user.zuid || user.user_id || '');
        const stored = profilesByZuid.get(zuid);
        const email = userEmail(user);
        const name = resolveUserName(user);
        return { user_zuid: zuid, user_name: stored?.user_name || name, email: stored?.email || email, role: String(stored?.role || 'ADMIN').toUpperCase(), is_active: stored?.is_active !== false };
      }).filter(user => user.user_zuid).sort((left, right) => left.user_name.localeCompare(right.user_name));
      return send(res, 200, { users });
    }

    if (req.method === 'POST' && path === '/profiles') {
      if (!isAdmin) return send(res, 403, { error: 'Profile management is available to Admin profiles only.' });
      const body = await readBody(req);
      const role = String(body.role || '').toUpperCase();
      const userZuid = String(body.user_zuid || '').trim();
      if (!userZuid || !['ADMIN', 'STANDARD'].includes(role)) return send(res, 400, { error: 'A user and a valid role are required.' });
      const found = await dataApp.zcql().executeZCQLQuery(`SELECT ROWID FROM UserProfiles WHERE user_zuid = '${zcqlValue(userZuid)}' LIMIT 1`);
      const existing = found[0] && (found[0].UserProfiles || found[0]);
      const row = { user_zuid: userZuid, user_name: String(body.user_name || '').trim(), email: String(body.email || '').trim(), role, is_active: body.is_active !== false };
      if (existing?.ROWID) await userProfiles.updateRow({ ROWID: existing.ROWID, ...row });
      else await userProfiles.insertRow(row);
      return send(res, 200, { profile: row });
    }

    if (req.method === 'POST' && path === '/crm/notifications/subscribe') {
      if (!isAdmin) return send(res, 403, { error: 'CRM notification setup is available to Admin profiles only.' });
      const notifyUrl = String(process.env.CRM_NOTIFICATION_URL || '').trim();
      const token = String(process.env.CRM_NOTIFICATION_TOKEN || '').trim();
      const channelId = String(process.env.CRM_NOTIFICATION_CHANNEL_ID || '').trim();
      if (!/^https:\/\//i.test(notifyUrl) || !token || !/^\d+$/.test(channelId)) {
        return send(res, 503, {
          error: 'Configure CRM_NOTIFICATION_URL, CRM_NOTIFICATION_TOKEN, and CRM_NOTIFICATION_CHANNEL_ID before enabling CRM notifications.'
        });
      }
      const connection = await app.connections().getConnectionCredentials(crmConnectionLinkName);
      try {
        return send(res, 200, await renewCrmWatchSubscription(connection));
      } catch (error) {
        return send(res, error.status || 502, { error: error.message, crm_response: error.crmBody });
      }
    }

    const findExistingFailure = async failureId => {
      if (!failureId) return false;
      const saved = await dataApp.zcql().executeZCQLQuery(
        `SELECT ROWID, bug_link, bug_title, feature, owner_name, failure_id, CREATEDTIME FROM Bugs WHERE failure_id = '${zcqlValue(failureId)}' ORDER BY CREATEDTIME DESC LIMIT 1`
      );
      return saved[0] && (saved[0].Bugs || saved[0]);
    };

    const crmBugMatch = path.match(/^\/crm\/bugs\/(\d+)$/);
    if (req.method === 'GET' && crmBugMatch) {
      const connection = await app.connections().getConnectionCredentials(crmConnectionLinkName);
      try {
        const record = await fetchCrmBugRecord(connection, crmBugMatch[1]);
        return send(res, 200, {
          name: crmField(record, 'Name'),
          report_name: crmField(record, 'Report_Name', 'ReportName'),
          feature_name: crmField(record, 'Feature_Name', 'FeatureName'),
          unique_id: crmField(record, 'Unique_ID', 'UniqueID', 'Unique_Id'),
          failure_id: crmField(record, 'FailureID', 'Failure_ID'),
          breakage: crmField(record, 'Breakage')
        });
      } catch (error) {
        return send(res, error.status || 502, { error: error.message || 'Unable to retrieve the CRM bug record.' });
      }
    }

    // Temporary Admin-only diagnostic: dumps the exact Bug_Tracking subform
    // rows centTrace sees for a CRM record, plus which row/category it would
    // currently derive, without applying any update. Used to debug stuck
    // "In Progress" bugs where CRM shows Fixed but centTrace never closes it.
    const crmBugDebugMatch = path.match(/^\/crm\/bugs\/(\d+)\/debug-tracking$/);
    if (req.method === 'GET' && crmBugDebugMatch) {
      if (!isAdmin) return send(res, 403, { error: 'This diagnostic is available to Admin profiles only.' });
      const connection = await app.connections().getConnectionCredentials(crmConnectionLinkName);
      try {
        const recordId = crmBugDebugMatch[1];
        const record = await fetchCrmBugRecord(connection, recordId);
        const trackingRows = automationTrackingRows(record, recordId);
        const trackingRowTime = row => Date.parse(crmValueText(crmField(row, 'Modified_Time', 'Created_Time'))) || 0;
        const trackingRowsHaveDistinctTimes = new Set(trackingRows.map(trackingRowTime).filter(time => time > 0)).size > 1;
        const latestTrackingRow = trackingRows.length
          ? (trackingRowsHaveDistinctTimes
            ? [...trackingRows].sort((rowA, rowB) => trackingRowTime(rowB) - trackingRowTime(rowA))[0]
            : trackingRows[0])
          : null;
        const automationStatus = normalizedCategoryValue(crmField(
          latestTrackingRow, 'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus'
        )) || normalizedCategoryValue(crmField(
          record, 'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus'
        ));
        const productIssueTrackingRow = trackingRows.find(row => ['productissue', 'mapexistingproductbug'].includes(normalizedCategoryValue(crmField(
          row, 'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus'
        ))));
        const crmStatus = normalizedCategoryValue(crmField(record, 'Status', 'Bug_Status', 'BugStatus'));
        const terminalOutcome = automationStatus || crmStatus;
        const closed = ['closed', 'fixed', 'resolved', 'notreproducibleai', 'notreproai', 'notreproduciblepi', 'notrepropi', 'accountspecificissue', 'accountspecific', 'dependencyservice', 'aalamissue', 'aalamsissue'].includes(terminalOutcome)
          || terminalOutcome.startsWith('closed');
        // Also surface the actual centTrace Bugs row(s) this CRM record maps to,
        // including ones the live webhook query would NOT pick up (archived or
        // not currently INVESTIGATING) - this is the key difference between "the
        // category logic is correct" and "the stuck bug actually got updated".
        let centTraceBugs = [];
        try {
          // A LIKE match on the raw record ID (not the stricter regex the
          // webhook uses) also surfaces rows whose bug_link is formatted
          // slightly differently than expected, so this can tell "wrong URL
          // format" apart from "no row exists at all".
          const storedAll = await dataApp.zcql().executeZCQLQuery(
            `SELECT ${bugColumns} FROM Bugs WHERE bug_link LIKE '%${zcqlValue(recordId)}%' LIMIT 50`
          );
          centTraceBugs = storedAll
            .map(value => value.Bugs || value)
            .map(bug => ({
              ROWID: bug.ROWID,
              status: bug.status,
              category: bug.category,
              is_archived: bug.is_archived,
              owner_name: bug.owner_name,
              bug_link: bug.bug_link,
              crm_id_from_link: crmRecordIdFromLink(bug.bug_link)
            }));
        } catch (error) { centTraceBugs = [{ error: error.message || String(error) }]; }
        // No bug_link matched this CRM record ID at all - fall back to matching
        // by subject text, so we can see what bug_link a row with the same
        // title is ACTUALLY pointing to (reveals a wrong/stale link pasted at
        // tracking time, as opposed to "never tracked in centTrace").
        let centTraceBugsBySubject = [];
        const subjectText = crmValueText(crmField(record, 'Name'));
        if (!centTraceBugs.length && subjectText) {
          try {
            const subjectFragment = subjectText.split(/[\s-]+/).filter(part => part.length > 3)[0] || subjectText.slice(0, 20);
            const bySubject = await dataApp.zcql().executeZCQLQuery(
              `SELECT ${bugColumns} FROM Bugs WHERE bug_title LIKE '%${zcqlValue(subjectFragment)}%' LIMIT 50`
            );
            centTraceBugsBySubject = bySubject
              .map(value => value.Bugs || value)
              .map(bug => ({
                ROWID: bug.ROWID,
                status: bug.status,
                category: bug.category,
                is_archived: bug.is_archived,
                owner_name: bug.owner_name,
                bug_title: bug.bug_title,
                bug_link: bug.bug_link,
                crm_id_from_link: crmRecordIdFromLink(bug.bug_link)
              }));
          } catch (error) { centTraceBugsBySubject = [{ error: error.message || String(error) }]; }
        }
        // Still nothing - list every currently active (non-archived) Bugs row
        // so the real stuck entry can be spotted visually and its actual
        // bug_link/owner compared against this CRM record.
        let allActiveBugs = [];
        if (!centTraceBugs.length && !centTraceBugsBySubject.length) {
          try {
            const allActive = await dataApp.zcql().executeZCQLQuery(
              `SELECT ${bugColumns} FROM Bugs WHERE is_archived = false ORDER BY CREATEDTIME DESC LIMIT 100`
            );
            allActiveBugs = allActive
              .map(value => value.Bugs || value)
              .map(bug => ({
                ROWID: bug.ROWID,
                status: bug.status,
                category: bug.category,
                owner_name: bug.owner_name,
                bug_title: bug.bug_title,
                bug_link: bug.bug_link,
                crm_id_from_link: crmRecordIdFromLink(bug.bug_link)
              }));
          } catch (error) { allActiveBugs = [{ error: error.message || String(error) }]; }
        }
        return send(res, 200, {
          subject: crmValueText(crmField(record, 'Name')),
          layout: crmValueText(crmField(record, '$layout', 'Layout', 'Layout_Name', 'LayoutName')),
          crmStatus,
          trackingRowCount: trackingRows.length,
          trackingRowsHaveDistinctTimes,
          trackingRows: trackingRows.map((row, index) => ({
            index,
            automation_bug_status_raw: crmField(row, 'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus'),
            automation_bug_status_normalized: normalizedCategoryValue(crmField(row, 'Automation_Bug_Status', 'AutomationBugStatus', 'Automation_Status', 'AutomationStatus')),
            modified_time_raw: crmField(row, 'Modified_Time', 'Created_Time'),
            parent_id: (() => { const p = crmField(row, 'Parent_Id', 'ParentId'); return typeof p === 'object' ? p?.id : p; })(),
            is_latest: row === latestTrackingRow
          })),
          automationStatus,
          terminalOutcome,
          closed,
          productIssueTrackingRowIndex: productIssueTrackingRow ? trackingRows.indexOf(productIssueTrackingRow) : -1,
          centTraceBugs,
          centTraceBugsBySubject,
          allActiveBugs
        });
      } catch (error) {
        return send(res, error.status || 502, { error: error.message || 'Unable to retrieve the CRM bug record.' });
      }
    }

    if (req.method === 'POST' && path === '/crm/bugs/unique-ids') {
      const body = await readBody(req);
      const recordIds = [...new Set((Array.isArray(body.record_ids) ? body.record_ids : [])
        .map(value => String(value || '').trim())
        .filter(value => /^\d+$/.test(value)))].slice(0, 200);
      if (!recordIds.length) return send(res, 200, { records: [] });
      const connection = await app.connections().getConnectionCredentials(crmConnectionLinkName);
      const recordsById = new Map();
      for (let index = 0; index < recordIds.length; index += 100) {
        const ids = recordIds.slice(index, index + 100);
        const params = new URLSearchParams({
          ids: ids.join(','),
          fields: 'Unique_ID,Feature_Name,Name',
          per_page: String(ids.length),
          approved: 'both',
          converted: 'both'
        });
        const crmResponse = await fetch(`${crmApiBase}/Bugs?${params}`, {
          headers: { ...connection.headers, Accept: 'application/json' }
        });
        if (crmResponse.status === 204) continue;
        const crmBody = await crmResponse.json();
        if (!crmResponse.ok) {
          return send(res, crmResponse.status, { error: crmBody.message || 'Unable to retrieve CRM Unique IDs.' });
        }
        (crmBody.data || []).forEach(record => {
          const summary = crmBugSummary(record);
          if (summary.id) recordsById.set(summary.id, summary);
        });
      }

      // Some older CRM list endpoints ignore the ids filter for custom modules.
      // Fetch any unmatched IDs through the exact-record endpoint in small batches.
      const incompleteIds = recordIds.filter(id => !recordsById.get(id)?.unique_id);
      for (let index = 0; index < incompleteIds.length; index += 10) {
        const exactRecords = await Promise.all(incompleteIds.slice(index, index + 10).map(async id => {
          try {
            return crmBugSummary(await fetchCrmBugRecord(connection, id), id);
          } catch (error) {
            if (error.status === 404 || error.status === 204) return null;
            throw error;
          }
        }));
        exactRecords.filter(Boolean).forEach(record => recordsById.set(record.id, record));
      }

      if (!recordsById.size) {
        return send(res, 502, {
          error: 'The crm_bug_lookup connection cannot access these CRM Bugs. Re-authorize it with an account in the CRM Release organization.'
        });
      }
      if (![...recordsById.values()].some(record => record.unique_id)) {
        return send(res, 422, {
          error: 'CRM returned the Bugs, but their Unique ID field is empty or hidden from the crm_bug_lookup connection.'
        });
      }
      return send(res, 200, { records: [...recordsById.values()] });
    }

    if (req.method === 'GET' && path === '/crm/restrictions') {
      const loggedInEmail = userEmail(currentUser);
      const loggedInName = resolveUserName(currentUser);
      const identityKey = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const bugConnection = await app.connections().getConnectionCredentials(crmConnectionLinkName);
      const crmUsers = [];
      try {
        const usersConnection = await app.connections().getConnectionCredentials(crmUsersConnectionLinkName);
        for (let page = 1; page <= 10; page += 1) {
          const usersResponse = await fetch(`${crmApiBase}/users?type=AllUsers&page=${page}&per_page=200`, {
            headers: { ...usersConnection.headers, Accept: 'application/json' }
          });
          const usersBody = await usersResponse.json().catch(() => ({}));
          if (!usersResponse.ok) throw Error(usersBody.message || 'Unable to retrieve CRM users.');
          crmUsers.push(...(usersBody.users || []));
          if (!usersBody.info?.more_records) break;
        }
      } catch (error) {
        console.warn('Unable to match the signed-in user through the CRM user directory:', error.message);
      }
      const loggedInCrmUser = crmUsers.find(user => userEmail(user) === loggedInEmail);
      const loggedInOwner = {
        id: String(loggedInCrmUser?.id || ''),
        name: loggedInCrmUser ? resolveUserName(loggedInCrmUser) : loggedInName,
        email: loggedInCrmUser ? userEmail(loggedInCrmUser) : loggedInEmail
      };
      const loggedInOwnerNameKey = identityKey(loggedInOwner.name);

      const records = [];
      let completedPagination = false;
      let pageToken = '';
      const usedPageTokens = new Set();
      let requestCount = 0;
      while (requestCount < 500) {
        requestCount += 1;
        const params = new URLSearchParams({
          cvid: restrictionCustomViewId,
          fields: 'Name,Report_Name,Feature_Name,Unique_ID,FailureID,Breakage,Owner,Created_Time,Modified_Time',
          per_page: '200'
        });
        if (pageToken) params.set('page_token', pageToken);
        else params.set('page', '1');
        const crmResponse = await fetch(`${crmApiBase}/Bugs?${params}`, {
          headers: { ...bugConnection.headers, Accept: 'application/json' }
        });
        if (crmResponse.status === 204) {
          if (requestCount === 1) {
            completedPagination = true;
            break;
          }
          return send(res, 502, { error: `CRM ended the Restriction response at batch ${requestCount} after indicating that more records were available.` });
        }
        const crmBody = await crmResponse.json().catch(() => ({}));
        if (!crmResponse.ok) {
          return send(res, crmResponse.status || 502, {
            error: crmBody.message || 'Unable to retrieve the CRM Restriction custom view.'
          });
        }
        const pageRecords = Array.isArray(crmBody.data) ? crmBody.data : [];
        const reportedPageCount = Number(crmBody.info?.count);
        if (Number.isFinite(reportedPageCount) && reportedPageCount !== pageRecords.length) {
          return send(res, 502, {
            error: `CRM reported ${reportedPageCount} Restriction records in batch ${requestCount}, but returned ${pageRecords.length}. Refresh to retry the complete sync.`
          });
        }
        if (crmBody.info?.more_records && !pageRecords.length) {
          return send(res, 502, { error: `CRM returned an empty Restriction batch ${requestCount} while more records were still available.` });
        }
        records.push(...pageRecords);
        if (!crmBody.info?.more_records) {
          completedPagination = true;
          break;
        }
        const nextPageToken = String(crmBody.info?.next_page_token || '').trim();
        if (!nextPageToken) {
          return send(res, 502, { error: `CRM indicated more Restriction records after batch ${requestCount}, but did not return the next page token.` });
        }
        if (usedPageTokens.has(nextPageToken)) {
          return send(res, 502, { error: 'CRM repeated a Restriction page token. CentTrace stopped instead of looping over partial data.' });
        }
        usedPageTokens.add(nextPageToken);
        pageToken = nextPageToken;
      }
      if (!completedPagination) {
        return send(res, 502, { error: 'The CRM Restriction view exceeds the CRM API limit of 100,000 records. CentTrace stopped instead of showing a partial list.' });
      }

      const recordsById = new Map();
      for (const record of records) {
        const id = String(record.id || '').trim();
        if (!id) return send(res, 502, { error: 'CRM returned a Restriction bug without a record ID. CentTrace stopped instead of dropping it.' });
        recordsById.set(id, record);
      }
      if (recordsById.size !== records.length) {
        return send(res, 502, { error: 'CRM returned duplicate Restriction bugs across pages. Refresh to retry the complete sync.' });
      }

      const ownerMatches = record => {
        const owner = record.Owner || record.owner || {};
        const ownerEmail = String(owner.email || '').trim().toLowerCase();
        const ownerId = String(owner.id || '');
        const ownerNameKey = identityKey(owner.name || owner.full_name || '');
        if ((loggedInOwner.email && ownerEmail === loggedInOwner.email)
          || (loggedInOwner.id && ownerId === loggedInOwner.id)
          || (loggedInOwnerNameKey && ownerNameKey === loggedInOwnerNameKey)) return true;
        if (ownerEmail || ownerId || ownerNameKey) return false;
        return null;
      };
      const completeRecords = [...recordsById.values()];
      const unknownOwnerRecords = completeRecords.filter(record => ownerMatches(record) === null);
      if (unknownOwnerRecords.length > 10) {
        return send(res, 502, { error: `CRM omitted the Bug Owner for ${unknownOwnerRecords.length} Restriction records. CentTrace stopped instead of silently dropping them.` });
      }
      if (unknownOwnerRecords.length) {
        const refreshedRecords = await Promise.all(unknownOwnerRecords.map(record => fetchCrmBugRecord(bugConnection, String(record.id))));
        refreshedRecords.forEach((record, index) => {
          recordsById.set(String(unknownOwnerRecords[index].id), { ...unknownOwnerRecords[index], ...record });
        });
      }
      const unresolvedOwnerCount = [...recordsById.values()].filter(record => ownerMatches(record) === null).length;
      if (unresolvedOwnerCount) {
        return send(res, 502, { error: `CRM did not provide enough Bug Owner data for ${unresolvedOwnerCount} Restriction records. CentTrace stopped instead of showing an incomplete owner list.` });
      }

      const ownRecords = [...recordsById.values()].filter(ownerMatches).map(record => {
        const owner = record.Owner || record.owner || {};
        const id = String(record.id || '');
        return {
          id,
          name: String(crmField(record, 'Name') || 'Untitled CRM bug'),
          report_name: String(crmField(record, 'Report_Name', 'ReportName') || ''),
          feature_name: String(crmField(record, 'Feature_Name', 'FeatureName') || ''),
          unique_id: String(crmField(record, 'Unique_ID', 'UniqueID', 'Unique_Id') || ''),
          failure_id: String(crmField(record, 'FailureID', 'Failure_ID') || ''),
          breakage: String(crmField(record, 'Breakage') || ''),
          owner_name: String(owner.name || owner.full_name || loggedInOwner.name),
          created_time: String(record.Created_Time || ''),
          modified_time: String(record.Modified_Time || ''),
          url: id ? `https://crm.zoho.in/crm/crmlaunchpad/tab/CustomModule2/${id}` : restrictionCustomViewUrl
        };
      }).sort((left, right) => String(right.modified_time || right.created_time).localeCompare(String(left.modified_time || left.created_time)));

      return send(res, 200, {
        bugs: ownRecords,
        owner_record_count: ownRecords.length,
        crm_view_record_count: records.length,
        crm_batch_count: requestCount,
        custom_view_url: restrictionCustomViewUrl,
        current_user: { name: loggedInName, email: loggedInEmail, crm_user_id: String(loggedInCrmUser?.id || '') }
      });
    }

    if (req.method === 'GET' && path === '/unstabilized/stabilized') {
      try {
        const saved = await readAllRows(stabilizedCases);
        const records = saved.sort((left, right) => String(right.CREATEDTIME || '').localeCompare(String(left.CREATEDTIME || '')));
        return send(res, 200, { records });
      } catch (error) {
        console.error('Unable to read StabilizedCases:', error);
        return send(res, 200, { records: [] });
      }
    }

    if (req.method === 'POST' && path === '/unstabilized/stabilized') {
      const body = await readBody(req);
      const uniqueId = String(body.unique_id || '').trim();
      if (!uniqueId) return send(res, 400, { error: 'Unique ID is required.' });
      const bugRowId = String(body.bug_row_id || '').trim();
      if (!/^\d+$/.test(bugRowId)) return send(res, 400, { error: 'The source bug is required.' });
      const matchingBugs = await dataApp.zcql().executeZCQLQuery(
        `SELECT ROWID, bug_link, owner_zuid, owner_name FROM Bugs WHERE ROWID = ${bugRowId} LIMIT 1`
      );
      const matchingBug = matchingBugs[0] && (matchingBugs[0].Bugs || matchingBugs[0]);
      if (!matchingBug) return send(res, 404, { error: 'The source bug was not found.' });
      if (!isStoredBugOwner(matchingBug, currentUser)) {
        return send(res, 403, { error: 'Only the owner of this case can mark it as stabilized.' });
      }
      const crmRecordId = String(matchingBug.bug_link || '').match(/\/(?:Bugs|CustomModule2)\/(\d+)(?:\?|\/|$)/i)?.[1]
        || String(matchingBug.bug_link || '').match(/\/crm\/v2\.2\/Bugs\/(\d+)/i)?.[1]
        || '';
      if (!crmRecordId) return send(res, 422, { error: 'The source bug does not contain a valid CRM record ID.' });
      try {
        const connection = await app.connections().getConnectionCredentials(crmConnectionLinkName);
        const crmRecord = await fetchCrmBugRecord(connection, crmRecordId);
        const crmUniqueId = String(crmField(crmRecord, 'Unique_ID', 'UniqueID', 'Unique_Id') || '').trim();
        if (!crmUniqueId || crmUniqueId !== uniqueId) {
          return send(res, 409, { error: 'The source bug no longer matches this Unique ID in CRM.' });
        }
      } catch (error) {
        return send(res, error.status || 502, { error: error.message || 'Unable to verify the source bug in CRM.' });
      }
      try {
        const saved = await readAllRows(stabilizedCases);
        const existing = saved.find(record => String(record.unique_id || '') === uniqueId);
        if (existing?.ROWID) return send(res, 200, { stabilized: true, unique_id: uniqueId, record: existing });
        const owner = ownerFor();
        const row = await stabilizedCases.insertRow({
          unique_id: uniqueId,
          feature_name: String(body.feature_name || '').trim(),
          stabilized_by_zuid: owner.zuid,
          stabilized_by_name: owner.name
        });
        return send(res, 201, {
          stabilized: true,
          unique_id: uniqueId,
          row_id: row.ROWID || row.row_id,
          record: { ...row, unique_id: uniqueId, feature_name: String(body.feature_name || '').trim(), stabilized_by_zuid: owner.zuid, stabilized_by_name: owner.name }
        });
      } catch (error) {
        console.error('Unable to update StabilizedCases:', error);
        return send(res, 503, { error: error.message || 'The stabilized case could not be saved.' });
      }
    }

    if (req.method === 'GET' && path === '/long-pending') {
      const ownerScope = isAdmin ? '' : ` WHERE owner_name = '${zcqlValue(resolveUserName(currentUser))}'`;
      const saved = await dataApp.zcql().executeZCQLQuery(
        `SELECT ${longPendingColumns} FROM LongPendingBugs${ownerScope} ORDER BY CREATEDTIME DESC LIMIT 200`
      );
      const bugsList = saved.map(record => record.LongPendingBugs || record);
      // LongPendingBugs keeps at most one row per failure_id (the latest occurrence replaces the prior
      // row), so the real "how many times has this bug been reported" count must come from the Bugs table.
      // Use the Data Store iterable-row API (same proven pattern as /bugs/summary) instead of a raw ZCQL
      // query, since ZCQL rejects SELECTs on the primary Data Store with no WHERE clause, and match
      // ownership the same robust way isStoredBugOwner does (pre-migration rows can carry a stale owner_zuid).
      const occurrenceCounts = {};
      try {
        const allBugRows = await readAllRows(bugs);
        allBugRows
          .filter(row => isAdmin || isStoredBugOwner(row, currentUser))
          .forEach(row => {
            const id = String(row.failure_id || '').trim();
            if (id) occurrenceCounts[id] = (occurrenceCounts[id] || 0) + 1;
          });
      } catch (error) {
        console.error('Unable to compute long-pending occurrence counts:', error);
      }
      return send(res, 200, {
        bugs: bugsList.map(bug => ({
          ...bug,
          occurrence_count: occurrenceCounts[String(bug.failure_id || '').trim()] || 1
        }))
      });
    }

    const longPendingOwnerMatch = path.match(/^\/long-pending\/([^/]+)\/owner$/);
    if (req.method === 'PATCH' && longPendingOwnerMatch) {
      if (!isAdmin) return send(res, 403, { error: 'Reassigning a Long Pending Issue is available to Admin profiles only.' });
      const failureId = decodeURIComponent(longPendingOwnerMatch[1]);
      const body = await readBody(req);
      const ownerName = String(body.owner_name || '').trim();
      if (!ownerName) return send(res, 400, { error: 'An owner is required.' });
      const found = await dataApp.zcql().executeZCQLQuery(
        `SELECT ROWID, owner_name, bug_link FROM LongPendingBugs WHERE failure_id = '${zcqlValue(failureId)}'`
      );
      const rows = found.map(record => record.LongPendingBugs || record);
      if (!rows.length) return send(res, 404, { error: 'This Long Pending Issue was not found.' });
      const previousOwnerName = String(rows[0].owner_name || '').trim() || 'Unassigned';
      const rowIds = rows.map(row => row.ROWID).filter(Boolean);
      await Promise.all(rowIds.map(ROWID => longPendingBugs.updateRow({ ROWID, owner_name: ownerName })));
      // Record the reassignment as a finding so both the previous and new owner can see who changed what.
      if (normalizedIdentity(previousOwnerName) !== normalizedIdentity(ownerName)) {
        try {
          await longPendingLogs.insertRow({
            failure_id: failureId,
            finding: `Owner changed from ${previousOwnerName} to ${ownerName}.`,
            owner_name: resolveUserName(currentUser),
            bug_link: rows[0].bug_link || ''
          });
        } catch (error) {
          console.error('Unable to log Long Pending owner reassignment:', error);
        }
      }
      return send(res, 200, { failure_id: failureId, owner_name: ownerName, previous_owner_name: previousOwnerName });
    }

    const longPendingDeleteMatch = path.match(/^\/long-pending\/([^/]+)$/);
    if (req.method === 'DELETE' && longPendingDeleteMatch) {
      const failureId = decodeURIComponent(longPendingDeleteMatch[1]);
      const found = await dataApp.zcql().executeZCQLQuery(
        `SELECT ROWID, owner_name FROM LongPendingBugs WHERE failure_id = '${zcqlValue(failureId)}'`
      );
      const rows = found.map(record => record.LongPendingBugs || record);
      if (!rows.length) return send(res, 404, { error: 'This Long Pending Issue was not found.' });
      // Owners can remove their own Long Pending Issue; Admin profiles can remove any.
      const canDelete = isAdmin || rows.some(row => normalizedIdentity(row.owner_name) === normalizedIdentity(resolveUserName(currentUser)));
      if (!canDelete) return send(res, 403, { error: 'Only the owner or an Admin profile can remove this Long Pending Issue.' });
      const rowIds = rows.map(row => row.ROWID).filter(Boolean);
      if (rowIds.length) await longPendingBugs.deleteRows(rowIds);
      try {
        const relatedLogs = await dataApp.zcql().executeZCQLQuery(
          `SELECT ROWID FROM LongPendingLogs WHERE failure_id = '${zcqlValue(failureId)}'`
        );
        const logIds = relatedLogs.map(record => (record.LongPendingLogs || record).ROWID).filter(Boolean);
        if (logIds.length) await longPendingLogs.deleteRows(logIds);
      } catch (error) {
        console.error('Unable to delete related LongPendingLogs:', error);
      }
      return send(res, 200, { deleted: true, failure_id: failureId });
    }

    const longPendingOccurrencesMatch = path.match(/^\/long-pending\/([^/]+)\/occurrences$/);
    if (req.method === 'GET' && longPendingOccurrencesMatch) {
      const failureId = decodeURIComponent(longPendingOccurrencesMatch[1]);
      const saved = await dataApp.zcql().executeZCQLQuery(
        `SELECT ${bugColumns} FROM Bugs WHERE failure_id = '${zcqlValue(failureId)}'${isAdmin ? '' : ` AND owner_zuid = '${zcqlValue(String(currentUser.zuid || currentUser.user_id || ''))}'`} ORDER BY CREATEDTIME DESC LIMIT 200`
      );
      return send(res, 200, { bugs: saved.map(record => record.Bugs || record) });
    }

    const longPendingLogsMatch = path.match(/^\/long-pending\/([^/]+)\/logs$/);
    if (longPendingLogsMatch && req.method === 'GET') {
      const failureId = decodeURIComponent(longPendingLogsMatch[1]);
      const saved = await dataApp.zcql().executeZCQLQuery(
        `SELECT ${longPendingLogColumns} FROM LongPendingLogs WHERE failure_id = '${zcqlValue(failureId)}'${isAdmin ? '' : ` AND owner_name = '${zcqlValue(resolveUserName(currentUser))}'`} ORDER BY CREATEDTIME DESC LIMIT 200`
      );
      return send(res, 200, { logs: saved.map(record => record.LongPendingLogs || record) });
    }

    if (longPendingLogsMatch && req.method === 'POST') {
      const body = await readBody(req);
      const finding = String(body.finding || '').trim();
      if (!finding) return send(res, 400, { error: 'A finding is required.' });
      const owner = ownerFor(body);
      const failureId = decodeURIComponent(longPendingLogsMatch[1]);
      const row = await longPendingLogs.insertRow({
        failure_id: failureId,
        finding,
        owner_name: owner.name,
        bug_link: body.bug_link || ''
      });
      return send(res, 201, { log: { ...row, failure_id: failureId, finding, owner_name: owner.name } });
    }

    if (req.method === 'POST' && path === '/bugs/long-pending-check') {
      const body = await readBody(req);
      const failureId = String(body.failure_id || '').trim();
      const existing = await findExistingFailure(failureId);
      const ownerScope = isAdmin ? '' : ` AND owner_name = '${zcqlValue(resolveUserName(currentUser))}'`;
      const existingLongPendingRows = failureId ? await dataApp.zcql().executeZCQLQuery(
        `SELECT ${longPendingColumns} FROM LongPendingBugs WHERE failure_id = '${zcqlValue(failureId)}'${ownerScope} ORDER BY CREATEDTIME DESC LIMIT 1`
      ) : [];
      const existingLongPending = existingLongPendingRows[0]
        && (existingLongPendingRows[0].LongPendingBugs || existingLongPendingRows[0]);
      const logRows = existingLongPending ? await dataApp.zcql().executeZCQLQuery(
        `SELECT ${longPendingLogColumns} FROM LongPendingLogs WHERE failure_id = '${zcqlValue(failureId)}'${ownerScope} ORDER BY CREATEDTIME DESC LIMIT 20`
      ) : [];
      return send(res, 200, {
        duplicate: Boolean(existing),
        previous_bug_link: existingLongPending?.bug_link || (isAdmin ? (existing?.bug_link || '') : ''),
        existing_long_pending: existingLongPending || null,
        existing_bug: isAdmin && existing ? existing : null,
        logs: logRows.map(record => record.LongPendingLogs || record)
      });
    }

    if (req.method === 'GET' && path === '/bugs/summary') {
      const ownerZuid = String(currentUser?.zuid || currentUser?.user_id || '');
      if (!ownerZuid) return send(res, 200, { bugs: [], current_user: {} });
      // Admin profiles can inspect another Catalyst user's personal Bug Summary
      // via ?target_zuid=/&target_name=, mirroring the Time Chart user picker.
      // Non-admins ignore these params entirely and always see only their own bugs.
      const targetZuid = isAdmin ? String(requestUrl.searchParams.get('target_zuid') || '').trim() : '';
      const summaryUser = targetZuid
        ? { zuid: targetZuid, full_name: String(requestUrl.searchParams.get('target_name') || '').trim() }
        : currentUser;
      const saved = await readAllRows(bugs);
      // Bugs migrated from the previous project keep that project's owner_zuid, so
      // ownership also accepts an exact normalized owner-name match.
      const ownerBugs = saved.filter(bug => (
        isStoredBugOwner(bug, summaryUser)
        && String(bug.status || '').toUpperCase() === 'FIXED'
        && String(bug.is_archived || '').toLowerCase() !== 'true'
      ));
      return send(res, 200, {
        bugs: ownerBugs,
        current_user: targetZuid ? {
          owner_zuid: targetZuid,
          owner_name: summaryUser.full_name || 'Catalyst user',
          owner_email: ''
        } : {
          owner_zuid: ownerZuid,
          owner_name: resolveUserName(currentUser),
          owner_email: userEmail(currentUser)
        }
      });
    }

    if (req.method === 'GET' && path === '/bugs/fixed-this-week') {
      const ownerZuid = String(currentUser?.zuid || currentUser?.user_id || '');
      if (!ownerZuid) return send(res, 200, { fixed_this_week: 0 });
      const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const calendarToday = new Date(`${todayDate}T00:00:00Z`);
      const weekStart = new Date(calendarToday);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      const weekStartDate = weekStart.toISOString().slice(0, 10);
      const saved = await dataApp.zcql().executeZCQLQuery(
        `SELECT verified_date FROM Bugs WHERE is_archived = false AND status = 'FIXED' AND owner_zuid = '${zcqlValue(ownerZuid)}' AND verified_date >= '${weekStartDate}' AND verified_date <= '${todayDate}' LIMIT 200`
      );
      const fixedThisWeek = saved
        .map(record => record.Bugs || record)
        .filter(bug => String(bug.verified_date || '') >= weekStartDate && String(bug.verified_date || '') <= todayDate).length;
      return send(res, 200, { fixed_this_week: fixedThisWeek });
    }

    if (req.method === 'GET' && path === '/bugs') {
      const [bugResult, sessionResult] = await Promise.all([
        dataApp.zcql().executeZCQLQuery(
        `SELECT ${bugColumns} FROM Bugs WHERE is_archived = false${isAdmin ? '' : ` AND owner_zuid = '${zcqlValue(String(currentUser.zuid || currentUser.user_id || ''))}'`} ORDER BY CREATEDTIME DESC LIMIT 200`
        ),
        dataApp.zcql().executeZCQLQuery(
          `SELECT ${sessionColumns} FROM DebugSessions ORDER BY started_at DESC LIMIT 300`
        )
      ]);
      const sessionsByBug = new Map();
      sessionResult.map(record => record.DebugSessions || record).forEach(session => {
        const key = String(session.bug_id);
        const isRunning = String(session.session_status || '').toUpperCase() === 'RUNNING';
        const startedAt = session.started_at ? new Date(`${String(session.started_at).replace(' ', 'T')}Z`).getTime() : NaN;
        const liveElapsed = isRunning && Number.isFinite(startedAt)
          ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
          : Number(session.elapsed_seconds || 0);
        sessionsByBug.set(key, [...(sessionsByBug.get(key) || []), {
          ...session,
          // This timestamp is calculated on the server from DebugSessions.started_at.
          // The browser uses it as the single source of truth for a running timer.
          started_at_epoch: Number.isFinite(startedAt) ? startedAt : null,
          elapsed_seconds: liveElapsed
        }]);
      });
      const storedBugs = bugResult.map(record => record.Bugs || record).map(bug => ({
        ...bug,
        debug_sessions: sessionsByBug.get(String(bug.ROWID)) || []
      }));
      return send(res, 200, {
        bugs: storedBugs,
        current_user: {
          owner_zuid: String(currentUser.zuid || currentUser.user_id || ''),
          owner_name: resolveUserName(currentUser),
          owner_email: userEmail(currentUser)
        },
        profile
      });
    }

    if (req.method === 'GET' && path === '/users') {
      if (!isAdmin) return send(res, 403, { error: 'User selection is available to Admin profiles only.' });
      const connection = await app.connections().getConnectionCredentials(crmUsersConnectionLinkName);
      const users = [];
      for (let page = 1; page <= 10; page += 1) {
        const crmResponse = await fetch(`${crmApiBase}/users?type=AllUsers&page=${page}&per_page=200`, { headers: { ...connection.headers, Accept: 'application/json' } });
        const crmBody = await crmResponse.json();
        if (!crmResponse.ok) return send(res, crmResponse.status, { error: crmBody.message || 'Unable to retrieve CRM users.' });
        users.push(...(crmBody.users || []));
        if (!crmBody.info?.more_records) break;
      }
      return send(res, 200, {
        users: users.map(user => ({
          zuid: String(user.id || ''),
          name: user.full_name || user.first_name || user.email || '',
          email: user.email || ''
        })).filter(user => user.zuid && user.name).sort((a, b) => a.name.localeCompare(b.name))
      });
    }

    if (req.method === 'POST' && path === '/bugs') {
      const body = await readBody(req);
      const owner = ownerFor(body);
      const required = ['bug_link', 'bug_title', 'milestone', 'release_type'];
      const missing = required.filter(key => !body[key]);
      if (missing.length) return send(res, 400, { error: `Missing required fields: ${missing.join(', ')}` });

      const startedAt = catalystDateTime(body.started_at);
      const endedAt = catalystDateTime(body.ended_at);
      const elapsedSeconds = startedAt && endedAt
        ? Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
        : Math.max(0, Number(body.total_elapsed_seconds || 0));

      const row = await bugs.insertRow({
        bug_link: body.bug_link,
        bug_title: body.bug_title,
        milestone: String(body.milestone),
        release_type: body.release_type,
        category: body.category || uncategorized,
        feature: body.feature || '',
        owner_zuid: owner.zuid,
        owner_name: owner.name,
        status: 'FIXED',
        verified_date: body.verified_date || new Date().toISOString().slice(0, 10),
        total_elapsed_seconds: elapsedSeconds,
        notes: body.notes || '',
        failure_id: body.failure_id || '',
        source: 'WEB_APP',
        is_archived: false
      });
      const session = await sessions.insertRow({
        bug_id: row.ROWID || row.row_id,
        started_at: startedAt || catalystDateTime(Date.now()),
        ended_at: endedAt || catalystDateTime(Date.now()),
        elapsed_seconds: elapsedSeconds,
        session_status: 'COMPLETED',
        started_by_zuid: owner.zuid,
        started_by_name: owner.name
      });
      return send(res, 201, {
        row_id: row.ROWID || row.row_id,
        session_id: session.ROWID || session.row_id,
        total_elapsed_seconds: elapsedSeconds,
        owner_zuid: owner.zuid,
        owner_name: owner.name
      });
    }

    if (req.method === 'POST' && path === '/bugs/start') {
      const body = await readBody(req);
      const owner = ownerFor(body);
      const required = ['bug_link', 'bug_title', 'milestone', 'release_type'];
      const missing = required.filter(key => !body[key]);
      if (missing.length) return send(res, 400, { error: `Missing required fields: ${missing.join(', ')}` });
      const startedAt = catalystDateTime(body.started_at) || catalystDateTime(Date.now());
      const existingFailure = await findExistingFailure(body.failure_id);
      const isDuplicateFailure = Boolean(existingFailure);
      const row = await bugs.insertRow({
        bug_link: body.bug_link, bug_title: body.bug_title, milestone: String(body.milestone),
        release_type: body.release_type, category: uncategorized, feature: body.feature || '', owner_zuid: owner.zuid,
        owner_name: owner.name, status: 'INVESTIGATING', total_elapsed_seconds: 0,
        failure_id: body.failure_id || '',
        notes: '', source: body.source === 'RESTRICTION' ? 'RESTRICTION' : 'WEB_APP', is_archived: false
      });
      const session = await sessions.insertRow({
        bug_id: row.ROWID || row.row_id, started_at: startedAt, elapsed_seconds: 0,
        session_status: 'RUNNING', started_by_zuid: owner.zuid, started_by_name: owner.name
      });
      if (isDuplicateFailure && body.add_as_long_pending === true) {
        const existingLongPending = await dataApp.zcql().executeZCQLQuery(
          `SELECT ROWID FROM LongPendingBugs WHERE failure_id = '${zcqlValue(body.failure_id)}'`
        );
        const oldLongPendingIds = existingLongPending
          .map(record => record.LongPendingBugs || record)
          .map(record => record.ROWID)
          .filter(Boolean);
        if (oldLongPendingIds.length) await longPendingBugs.deleteRows(oldLongPendingIds);
        await longPendingBugs.insertRow({
          failure_id: body.failure_id,
          feature_name: body.feature || '',
          breakage: body.breakage || '',
          bug_link: body.bug_link,
          bug_title: body.bug_title || '',
          owner_name: owner.name
        });
      }
      return send(res, 201, {
        row_id: row.ROWID || row.row_id,
        session_id: session.ROWID || session.row_id,
        added_as_long_pending: isDuplicateFailure && body.add_as_long_pending === true,
        owner_zuid: owner.zuid,
        owner_name: owner.name
      });
    }

    const activeBugForTimer = async rowId => {
      const stored = await dataApp.zcql().executeZCQLQuery(
        `SELECT ROWID, owner_zuid, status, total_elapsed_seconds FROM Bugs WHERE ROWID = ${rowId} LIMIT 1`
      );
      const bug = stored[0] && (stored[0].Bugs || stored[0]);
      if (!bug) return { error: 'Bug record was not found.', status: 404 };
      // Admins can view every owner's bugs, but pausing/resuming/finishing a
      // debugging timer is restricted to the bug's own owner, with no Admin
      // override - Admin visibility must not imply write access here.
      if (String(bug.owner_zuid || '') !== String(currentUser.zuid || currentUser.user_id || '')) {
        return { error: 'You can manage only your own debugging timer.', status: 403 };
      }
      if (String(bug.status || '').toUpperCase() === 'FIXED') return { error: 'This bug is already completed.', status: 409 };
      return { bug };
    };
    const timerSessionsFor = async rowId => {
      const rows = await dataApp.zcql().executeZCQLQuery(
        `SELECT ROWID, started_at, ended_at, elapsed_seconds, session_status FROM DebugSessions WHERE bug_id = ${rowId} ORDER BY CREATEDTIME ASC`
      );
      return rows.map(record => record.DebugSessions || record);
    };
    const elapsedBetween = (startedAt, endedAt) => {
      const start = new Date(String(startedAt || '').replace(' ', 'T') + 'Z').getTime();
      const end = new Date(String(endedAt || '').replace(' ', 'T') + 'Z').getTime();
      return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
    };

    if (req.method === 'POST' && path === '/bugs/pause') {
      const body = await readBody(req);
      const rowId = String(body.row_id || '').trim();
      if (!/^\d+$/.test(rowId)) return send(res, 400, { error: 'A valid row_id is required.' });
      const active = await activeBugForTimer(rowId);
      if (active.error) return send(res, active.status, { error: active.error });
      const sessionRows = await timerSessionsFor(rowId);
      const requestedSessionId = String(body.session_id || '').trim();
      const runningSession = sessionRows.find(session => String(session.session_status || '').toUpperCase() === 'RUNNING'
        && (!/^\d+$/.test(requestedSessionId) || String(session.ROWID) === requestedSessionId));
      if (!runningSession?.ROWID) return send(res, 409, { error: 'This debugging timer is already paused.' });
      const endedAt = catalystDateTime(body.ended_at) || catalystDateTime(Date.now());
      const segmentElapsed = elapsedBetween(runningSession.started_at, endedAt);
      await sessions.updateRow({
        ROWID: runningSession.ROWID,
        ended_at: endedAt,
        elapsed_seconds: segmentElapsed,
        session_status: 'PAUSED'
      });
      const totalElapsed = sessionRows.reduce((total, session) => total + (String(session.ROWID) === String(runningSession.ROWID)
        ? segmentElapsed : Number(session.elapsed_seconds || 0)), 0);
      await bugs.updateRow({ ROWID: rowId, total_elapsed_seconds: totalElapsed });
      return send(res, 200, {
        row_id: rowId,
        paused: true,
        total_elapsed_seconds: totalElapsed
      });
    }

    if (req.method === 'POST' && path === '/bugs/resume') {
      const body = await readBody(req);
      const rowId = String(body.row_id || '').trim();
      if (!/^\d+$/.test(rowId)) return send(res, 400, { error: 'A valid row_id is required.' });
      const active = await activeBugForTimer(rowId);
      if (active.error) return send(res, active.status, { error: active.error });
      const sessionRows = await timerSessionsFor(rowId);
      const persistedElapsed = sessionRows
        .filter(session => String(session.session_status || '').toUpperCase() !== 'RUNNING')
        .reduce((total, session) => total + Number(session.elapsed_seconds || 0), 0);
      const alreadyRunning = sessionRows.find(session => String(session.session_status || '').toUpperCase() === 'RUNNING');
      if (alreadyRunning?.ROWID) {
        const now = catalystDateTime(Date.now());
        const totalElapsed = persistedElapsed + elapsedBetween(alreadyRunning.started_at, now);
        return send(res, 200, {
          row_id: rowId,
          resumed: true,
          session_id: alreadyRunning.ROWID,
          started_at: alreadyRunning.started_at,
          total_elapsed_seconds: totalElapsed
        });
      }
      const startedAt = catalystDateTime(body.started_at) || catalystDateTime(Date.now());
      const owner = ownerFor();
      const session = await sessions.insertRow({
        bug_id: rowId,
        started_at: startedAt,
        elapsed_seconds: 0,
        session_status: 'RUNNING',
        started_by_zuid: owner.zuid,
        started_by_name: owner.name
      });
      await bugs.updateRow({ ROWID: rowId, total_elapsed_seconds: persistedElapsed });
      return send(res, 201, {
        row_id: rowId,
        resumed: true,
        session_id: session.ROWID || session.row_id,
        started_at: startedAt,
        total_elapsed_seconds: persistedElapsed
      });
    }

    const deleteBugMatch = path.match(/^\/bugs\/(\d+)(?:\/delete-check)?$/);
    const getTodayCompletedBug = async rowId => {
      const matches = await dataApp.zcql().executeZCQLQuery(
        `SELECT ${bugColumns} FROM Bugs WHERE ROWID = ${rowId} LIMIT 1`
      );
      const bug = matches[0] && (matches[0].Bugs || matches[0]);
      if (!bug) return { error: 'Bug record was not found.', status: 404 };
      // Deleting a closed bug is also owner-only; Admin can view it but not
      // delete it on the owner's behalf.
      if (String(bug.owner_zuid || '') !== String(currentUser.zuid || currentUser.user_id || '')) return { error: 'You can manage only your own bugs.', status: 403 };
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      if (String(bug.status || '').toUpperCase() !== 'FIXED' || bug.verified_date !== today) {
        return { error: 'Only bugs closed today can be deleted.', status: 403 };
      }
      return { bug };
    };
    const longPendingForBug = async bug => {
      if (!bug.failure_id || !bug.bug_link) return [];
      const rows = await dataApp.zcql().executeZCQLQuery(
        `SELECT ROWID FROM LongPendingBugs WHERE failure_id = '${zcqlValue(bug.failure_id)}' AND bug_link = '${zcqlValue(bug.bug_link)}'`
      );
      return rows.map(record => record.LongPendingBugs || record).map(record => record.ROWID).filter(Boolean);
    };
    if (req.method === 'GET' && deleteBugMatch && path.endsWith('/delete-check')) {
      const result = await getTodayCompletedBug(deleteBugMatch[1]);
      if (result.error) return send(res, result.status, { error: result.error });
      const longPendingIds = await longPendingForBug(result.bug);
      return send(res, 200, { long_pending: longPendingIds.length > 0 });
    }
    if (req.method === 'DELETE' && deleteBugMatch) {
      const result = await getTodayCompletedBug(deleteBugMatch[1]);
      if (result.error) return send(res, result.status, { error: result.error });
      const body = await readBody(req);
      const rowId = deleteBugMatch[1];
      const longPendingIds = await longPendingForBug(result.bug);
      if (longPendingIds.length && body.delete_long_pending !== true) {
        return send(res, 409, { error: 'This bug is in Long Pending Bugs.', long_pending: true });
      }
      const sessionRows = await dataApp.zcql().executeZCQLQuery(`SELECT ROWID FROM DebugSessions WHERE bug_id = ${rowId}`);
      const sessionIds = sessionRows.map(record => record.DebugSessions || record).map(session => session.ROWID).filter(Boolean);
      if (sessionIds.length) await sessions.deleteRows(sessionIds);
      if (longPendingIds.length) {
        const logRows = await dataApp.zcql().executeZCQLQuery(
          `SELECT ROWID FROM LongPendingLogs WHERE failure_id = '${zcqlValue(result.bug.failure_id)}'`
        );
        const logIds = logRows.map(record => record.LongPendingLogs || record).map(record => record.ROWID).filter(Boolean);
        if (logIds.length) await longPendingLogs.deleteRows(logIds);
        await longPendingBugs.deleteRows(longPendingIds);
      }
      await bugs.deleteRow(rowId);
      return send(res, 200, { deleted: true, row_id: rowId });
    }

    if (req.method === 'POST' && path === '/bugs/classification') {
      const body = await readBody(req);
      const rowId = String(body.row_id || '').trim();
      if (!/^\d+$/.test(rowId)) return send(res, 400, { error: 'A valid row_id is required.' });
      const category = String(body.category || '').trim();
      const assignedUserName = String(body.assigned_user_name || '').trim();
      const assignedUserZuid = String(body.assigned_user_zuid || '').trim();
      if (!category || category.length > 100) return send(res, 400, { error: 'A category is required.' });
      if (assignedUserZuid && !assignedUserName) return send(res, 400, { error: 'The assigned user name is required.' });
      const matches = await dataApp.zcql().executeZCQLQuery(`SELECT ${bugColumns} FROM Bugs WHERE ROWID = ${rowId} LIMIT 1`);
      const bug = matches[0] && (matches[0].Bugs || matches[0]);
      if (!bug) return send(res, 404, { error: 'Bug record was not found.' });
      // Editing category/assignee on a closed bug is owner-only; Admin can
      // view but not modify another owner's bug.
      if (!isStoredBugOwner(bug, currentUser)) return send(res, 403, { error: 'You can edit only your own bugs.' });
      if (String(bug.status || '').toUpperCase() !== 'FIXED') return send(res, 409, { error: 'Only closed bugs can be edited.' });
      await bugs.updateRow({
        ROWID: rowId, category, assigned_user_name: assignedUserName, assigned_user_zuid: assignedUserZuid
      });
      return send(res, 200, {
        row_id: rowId, category, assigned_user_name: assignedUserName, assigned_user_zuid: assignedUserZuid
      });
    }

    if (req.method === 'POST' && path === '/bugs/complete') {
      const body = await readBody(req);
      const owner = ownerFor();
      // Catalyst ROWIDs exceed JavaScript's safe integer range. Keep them as
      // validated digit strings so their exact value is preserved in ZCQL.
      const rowId = String(body.row_id || '').trim();
      if (!/^\d+$/.test(rowId)) return send(res, 400, { error: 'A valid row_id is required.' });
      const active = await activeBugForTimer(rowId);
      if (active.error) return send(res, active.status, { error: active.error });
      const requestedSessionId = String(body.session_id || '').trim();
      const sessionRows = await timerSessionsFor(rowId);
      if (!sessionRows.length) return send(res, 404, { error: 'No debugging sessions were found for this bug.' });
      const runningSession = sessionRows.find(session => String(session.session_status || '').toUpperCase() === 'RUNNING'
        && (!/^\d+$/.test(requestedSessionId) || String(session.ROWID) === requestedSessionId))
        || sessionRows.find(session => String(session.session_status || '').toUpperCase() === 'RUNNING');
      const endedAt = catalystDateTime(body.ended_at) || catalystDateTime(Date.now());
      const runningElapsed = runningSession ? elapsedBetween(runningSession.started_at, endedAt) : 0;
      const elapsedSeconds = sessionRows.reduce((total, session) => total + (runningSession && String(session.ROWID) === String(runningSession.ROWID)
        ? runningElapsed : Number(session.elapsed_seconds || 0)), 0);
      await bugs.updateRow({
        ROWID: rowId, category: body.category || uncategorized, feature: body.feature || '', notes: body.notes || '',
        assigned_user_name: body.assigned_user_name || '', assigned_user_zuid: body.assigned_user_zuid || '',
        status: 'FIXED', verified_date: body.verified_date || new Date().toISOString().slice(0, 10), total_elapsed_seconds: elapsedSeconds
      });
      let completedSessionId = runningSession?.ROWID || '';
      if (runningSession) {
        await sessions.updateRow({ ROWID: runningSession.ROWID, ended_at: endedAt, elapsed_seconds: runningElapsed, session_status: 'COMPLETED' });
      } else {
        // A paused bug has no active segment. Add a zero-duration completion
        // marker so the final completion time remains distinct from the pause.
        const completedSession = await sessions.insertRow({
          bug_id: rowId,
          started_at: endedAt,
          ended_at: endedAt,
          elapsed_seconds: 0,
          session_status: 'COMPLETED',
          started_by_zuid: owner.zuid,
          started_by_name: owner.name
        });
        completedSessionId = completedSession.ROWID || completedSession.row_id || '';
      }
      return send(res, 200, {
        row_id: rowId,
        session_id: completedSessionId,
        total_elapsed_seconds: elapsedSeconds,
        owner_zuid: owner.zuid,
        owner_name: owner.name
      });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message || 'Unable to access Data Store' });
  }
};
