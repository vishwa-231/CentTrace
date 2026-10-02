#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.join(root, 'migration', 'generated');
const bugsArchive = path.join(root, 'Export_35915000000127038_2513148258861375.zip');
const sessionsArchive = path.join(root, 'Export_35915000000115799_2513403027670083.zip');

const parseCsv = text => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV ended inside a quoted field.');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
};

const quoteCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
const formatCsv = rows => `${rows.map(row => row.map(quoteCsv).join(',')).join('\n')}\n`;

const recordsFromRows = rows => {
  const [headers, ...values] = rows;
  if (!headers?.length) throw new Error('CSV has no header row.');
  return values.filter(row => row.some(Boolean)).map((row, rowIndex) => {
    if (row.length !== headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} has ${row.length} fields; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  });
};

const readArchiveCsv = (archive, entry) => {
  const text = execFileSync('unzip', ['-p', archive, entry], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return recordsFromRows(parseCsv(text.replace(/^\uFEFF/, '')));
};

const writeRecords = (fileName, columns, records) => {
  const rows = [columns, ...records.map(record => columns.map(column => record[column] ?? ''))];
  fs.writeFileSync(path.join(outputDirectory, fileName), formatCsv(rows));
};

const readCsvFile = filePath => {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  const headers = rows[0] || [];
  return { headers, records: recordsFromRows(rows) };
};

const requireColumns = (records, columns, label) => {
  if (!records.length) throw new Error(`${label} contains no records.`);
  const missing = columns.filter(column => !(column in records[0]));
  if (missing.length) throw new Error(`${label} is missing columns: ${missing.join(', ')}`);
};

const bugColumns = [
  'legacy_rowid', 'bug_title', 'milestone', 'release_type', 'category', 'feature',
  'owner_zuid', 'owner_name', 'status', 'verified_date', 'total_elapsed_seconds',
  'notes', 'source', 'is_archived', 'assigned_user_name', 'assigned_user_zuid',
  'bug_link', 'failure_id'
];

const sessionColumns = [
  'legacy_bug_id', 'started_at', 'ended_at', 'elapsed_seconds', 'session_status',
  'started_by_zuid', 'started_by_name'
];

const remainingTables = {
  LongPendingBugs: ['failure_id', 'feature_name', 'breakage', 'bug_link', 'bug_title', 'owner_name'],
  LongPendingLogs: ['failure_id', 'finding', 'owner_name', 'bug_link'],
  UserProfiles: ['user_zuid', 'user_name', 'email', 'role', 'is_active'],
  StabilizedCases: ['unique_id', 'feature_name', 'stabilized_by_zuid', 'stabilized_by_name']
};

const assertUnique = (records, column, label) => {
  const values = records.map(record => String(record[column] || '').trim()).filter(Boolean);
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate ${column} values.`);
};

const prepare = () => {
  const bugs = readArchiveCsv(bugsArchive, 'Table-Bugs.csv');
  const sessions = readArchiveCsv(sessionsArchive, 'Table-DebugSessions.csv');
  requireColumns(bugs, ['ROWID', ...bugColumns.slice(1)], 'Bugs export');
  requireColumns(sessions, ['bug_id', ...sessionColumns.slice(1)], 'DebugSessions export');

  const legacyBugIds = new Set(bugs.map(record => record.ROWID));
  if (legacyBugIds.size !== bugs.length) throw new Error('Bugs export contains duplicate ROWIDs.');
  const bugsByLink = new Map();
  bugs.forEach(record => {
    const link = String(record.bug_link || '').trim();
    if (!bugsByLink.has(link)) bugsByLink.set(link, []);
    bugsByLink.get(link).push(record.ROWID);
  });
  const emptyBugLinks = bugsByLink.get('') || [];
  const duplicateBugLinks = [...bugsByLink.entries()].filter(([link, ids]) => link && ids.length > 1);
  const missingParents = [...new Set(sessions.map(record => record.bug_id).filter(id => !legacyBugIds.has(id)))];
  if (missingParents.length) {
    throw new Error(`${missingParents.length} DebugSessions bug_id values have no Bugs parent: ${missingParents.slice(0, 5).join(', ')}`);
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  const bugsWithoutCategory = bugs.filter(record => !String(record.category || '').trim());
  const migrationBug = record => ({
    ...record,
    legacy_rowid: record.ROWID,
    category: String(record.category || '').trim() || 'Uncategorized'
  });
  writeRecords('Bugs.import.csv', bugColumns, bugs.map(migrationBug));
  writeRecords('Bugs.retry-empty-category.csv', bugColumns, bugsWithoutCategory.map(migrationBug));
  writeRecords('DebugSessions.pending-remap.csv', sessionColumns, sessions.map(record => ({ ...record, legacy_bug_id: record.bug_id })));
  console.log(`Prepared ${bugs.length} Bugs and ${sessions.length} DebugSessions.`);
  console.log('Every DebugSessions parent reference matches an exported Bugs ROWID.');
  console.log(`Bug-link mapping check: ${emptyBugLinks.length} empty, ${duplicateBugLinks.length} duplicated.`);
  console.log(`Empty-category Bugs retry set: ${bugsWithoutCategory.length}.`);
  console.log(`Output: ${path.relative(root, outputDirectory)}`);
};

const remap = mappingFile => {
  if (!mappingFile) {
    throw new Error('Pass the CSV exported from the new Bugs table after import.');
  }
  const mappingPath = path.resolve(process.cwd(), mappingFile);
  const newBugs = recordsFromRows(parseCsv(fs.readFileSync(mappingPath, 'utf8').replace(/^\uFEFF/, '')));
  const pendingPath = path.join(outputDirectory, 'DebugSessions.pending-remap.csv');
  const pendingSessions = recordsFromRows(parseCsv(fs.readFileSync(pendingPath, 'utf8').replace(/^\uFEFF/, '')));
  requireColumns(newBugs, ['ROWID', 'legacy_rowid'], 'New Bugs export');
  requireColumns(pendingSessions, sessionColumns, 'Pending DebugSessions file');

  const mapping = new Map();
  newBugs.forEach(record => {
    if (!record.ROWID || !record.legacy_rowid) return;
    if (mapping.has(record.legacy_rowid)) throw new Error(`Duplicate legacy_rowid in new Bugs export: ${record.legacy_rowid}`);
    mapping.set(record.legacy_rowid, record.ROWID);
  });
  const missing = [...new Set(pendingSessions.map(record => record.legacy_bug_id).filter(id => !mapping.has(id)))];
  if (missing.length) {
    throw new Error(`${missing.length} legacy Bugs ROWIDs are absent from the new Bugs export: ${missing.slice(0, 5).join(', ')}`);
  }

  const importColumns = ['bug_id', ...sessionColumns.slice(1)];
  const remapped = pendingSessions.map(record => ({ ...record, bug_id: mapping.get(record.legacy_bug_id) }));
  writeRecords('DebugSessions.import.csv', importColumns, remapped);
  console.log(`Remapped ${remapped.length} DebugSessions using ${mapping.size} Bugs mappings.`);
  console.log('Output: migration/generated/DebugSessions.import.csv');
};

const prepareRemaining = sourceDirectory => {
  if (!sourceDirectory) throw new Error('Pass the directory containing the four Table-*.csv exports.');
  const sourcePath = path.resolve(process.cwd(), sourceDirectory);
  const prepared = {};
  fs.mkdirSync(outputDirectory, { recursive: true });

  Object.entries(remainingTables).forEach(([table, columns]) => {
    const filePath = path.join(sourcePath, `Table-${table}.csv`);
    const { headers, records } = readCsvFile(filePath);
    const missing = columns.filter(column => !headers.includes(column));
    if (missing.length) throw new Error(`${table} export is missing columns: ${missing.join(', ')}`);
    prepared[table] = records;
    writeRecords(`${table}.import.csv`, columns, records);
    console.log(`Prepared ${records.length} ${table} records.`);
  });

  assertUnique(prepared.LongPendingBugs, 'failure_id', 'LongPendingBugs export');
  assertUnique(prepared.UserProfiles, 'user_zuid', 'UserProfiles export');
  assertUnique(prepared.StabilizedCases, 'unique_id', 'StabilizedCases export');

  const longPendingIds = new Set(prepared.LongPendingBugs.map(record => record.failure_id));
  const orphanLogIds = [...new Set(prepared.LongPendingLogs
    .map(record => record.failure_id)
    .filter(failureId => !longPendingIds.has(failureId)))];
  if (orphanLogIds.length) {
    throw new Error(`LongPendingLogs contains failure IDs absent from LongPendingBugs: ${orphanLogIds.join(', ')}`);
  }

  const invalidProfiles = prepared.UserProfiles.filter(record =>
    !['ADMIN', 'STANDARD'].includes(record.role) || !['true', 'false'].includes(record.is_active.toLowerCase())
  );
  if (invalidProfiles.length) throw new Error('UserProfiles contains an invalid role or is_active value.');
  console.log(`Output: ${path.relative(root, outputDirectory)}`);
};

try {
  const [command = 'prepare', argument] = process.argv.slice(2);
  if (command === 'prepare') prepare();
  else if (command === 'remap') remap(argument);
  else if (command === 'prepare-remaining') prepareRemaining(argument);
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`Migration preparation failed: ${error.message}`);
  process.exitCode = 1;
}
