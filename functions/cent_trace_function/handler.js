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
  'total_elapsed_seconds', 'notes', 'assigned_user_name', 'assigned_user_zuid', 'failure_id', 'source', 'is_archived', 'CREATEDTIME'
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

const crmConnectionLinkName = 'crm_bug_lookup';
const crmUsersConnectionLinkName = 'crm_org_users';
const crmApiBase = 'https://www.zohoapis.in/crm/v8';
const crmLegacyApiBase = 'https://www.zohoapis.in/crm/v2.2';
const restrictionCustomViewId = '1034369000840611390';
const restrictionCustomViewUrl = `https://crm.zoho.in/crm/crmlaunchpad/tab/CustomModule2/custom-view/${restrictionCustomViewId}/list`;
const adminEmails = new Set(['vishwa.sr@zohocorp.com']);
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

module.exports = async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    // Data Store operations use the function credential. The signed-in user
    // credential remains the source of identity, and every owner/profile
    // authorization check below is evaluated before a protected operation.
    const dataApp = catalyst.initialize(req, { scope: 'admin' });
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
    const profile = { role: ['ADMIN', 'STANDARD'].includes(savedRole) ? savedRole : (adminEmails.has(userEmail(currentUser)) ? 'ADMIN' : 'STANDARD') };
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
    const requestUrl = new URL(req.url, 'http://localhost');
    const path = requestUrl.pathname;


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
        return { user_zuid: zuid, user_name: stored?.user_name || name, email: stored?.email || email, role: String(stored?.role || (adminEmails.has(email) ? 'ADMIN' : 'STANDARD')).toUpperCase(), is_active: stored?.is_active !== false };
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
        const saved = await stabilizedCases.getPagedRows({ maxRows: 1000 });
        const records = (saved.data || []).sort((left, right) => String(right.CREATEDTIME || '').localeCompare(String(left.CREATEDTIME || '')));
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
        `SELECT ROWID, bug_link, owner_zuid FROM Bugs WHERE ROWID = ${bugRowId} LIMIT 1`
      );
      const matchingBug = matchingBugs[0] && (matchingBugs[0].Bugs || matchingBugs[0]);
      if (!matchingBug) return send(res, 404, { error: 'The source bug was not found.' });
      if (String(matchingBug.owner_zuid || '') !== currentZuid) {
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
        const saved = await stabilizedCases.getPagedRows({ maxRows: 1000 });
        const existing = (saved.data || []).find(record => String(record.unique_id || '') === uniqueId);
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
        return send(res, 503, { error: 'The StabilizedCases Data Store table is not configured yet.' });
      }
    }

    if (req.method === 'GET' && path === '/long-pending') {
      const ownerScope = isAdmin ? '' : ` WHERE owner_name = '${zcqlValue(resolveUserName(currentUser))}'`;
      const saved = await dataApp.zcql().executeZCQLQuery(
        `SELECT ${longPendingColumns} FROM LongPendingBugs${ownerScope} ORDER BY CREATEDTIME DESC LIMIT 200`
      );
      return send(res, 200, { bugs: saved.map(record => record.LongPendingBugs || record) });
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
      if (!isAdmin && String(bug.owner_zuid || '') !== String(currentUser.zuid || currentUser.user_id || '')) {
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
      if (!isAdmin && String(bug.owner_zuid || '') !== String(currentUser.zuid || currentUser.user_id || '')) return { error: 'You can manage only your own bugs.', status: 403 };
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
