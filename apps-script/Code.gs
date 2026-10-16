/**
 * VINI Accounts Alert — Metabase email → Daily + Alerts + Log. No Slack.
 *
 * Paste the whole file into Extensions → Apps Script on VINI Accounts Alert Tracker.
 * Advanced Google service: Drive API (v2) as "Drive" (for .xlsx attachments).
 *
 * Version: 2026-10-17-mail-once-daily
 *
 * Why 14 Oct and 15 Oct were missing
 *   The 16 Oct log says the latest mail was already labeled VINI-Alert-Processed,
 *   so processLatestMetabaseEmail refused to open it. An earlier test did open it:
 *   Daily was updated, then Alerts were skipped because Sales IB had no rows on
 *   2026-10-15. One missing agent cancelled the whole day, including 14 Oct, which
 *   is already on Daily.
 *
 * CSM names
 *   The CSM tab already exists (gid 376341429, the tab may be named "CSM ").
 *   Do not create a second one. setupCsmSheet only reads it.
 *   Do not write CSM names onto the Alerts tab. Column I is left unchanged.
 *   The Slack image matches Alerts enterprise_id to Enterprise ID, then uses
 *   the CSM Name cell as stored. A Vini row wins over a Studio row.
 *
 * Run once after pasting, in this order:
 *   1. verifyViniAlertCodeVersion
 *   2. removeAllTriggers
 *   3. setupDailyTrigger
 *
 * Do not run catchUpMetabaseEmails on this paste. The sheet already has the
 * rows from the earlier catch-up. The daily mail is the only writer now.
 *
 * The daily trigger runs once, at 4:00 AM India time, after the Metabase
 * mail that arrives at 22:00 UTC. It writes Daily, Alerts, and Log only
 * when that new mail is in the inbox. It does not write every hour.
 * Slack is not sent from here. The GitHub job only reads the Alerts tab.
 * Sunday still does not create Alerts. Monday uses Saturday.
 */
var VINI_SCRIPT_VERSION = '2026-10-17-mail-once-daily';
var CSM_TAB_GID = 376341429;
var ALERTS_FILL_SINCE = '2026-10-13';
var INCOMPLETE_ATTEMPT_FLOOR = 400;
var METABASE_DAILY_HEADERS = [
  'activity_day', 'enterprise_id', 'enterprise_name', 'rooftop_name', 'agent',
  'call_attempts', 'engaged', 'qualified', 'appointments',
  'engaged_pct', 'qualified_pct', 'appt_rate',
];
var METABASE_ALERTS_HEADERS = [
  'Date', 'Agent', 'Rule', 'enterprise_id', 'rooftop_name', 'Value', 'Threshold', 'Notes', 'CSM',
];
/** Days before today that a normal run will upsert. Seven covers a missed week. */
var METABASE_UPSERT_DAYS = 7;
var SHARED_TIMEZONE = 'Asia/Kolkata';

function deleteTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('All triggers removed.');
}
function setupSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var daily = ensureSheet_(ss, 'Daily', METABASE_DAILY_HEADERS);
  var alerts = ensureSheet_(ss, 'Alerts', METABASE_ALERTS_HEADERS);
  return { daily: daily, alerts: alerts };
}
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function ensureAlertsHasCsmColumn_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), METABASE_ALERTS_HEADERS.length);
  var row1 = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (String(row1[8] || '').trim().toLowerCase() !== 'csm') {
    sh.getRange(1, 9).setValue('CSM').setFontWeight('bold');
  }
}

function upsertMetabaseRowsToDaily_(parsedRows, bounds) {
  if (!parsedRows || !parsedRows.length) return 0;
  bounds = bounds || {};
  var sheets = setupSheets_();
  var sh = sheets.daily;
  var cap = bounds.cap || Utilities.formatDate(new Date(), SHARED_TIMEZONE, 'yyyy-MM-dd');
  var minDay = bounds.minDay || addDays_(cap, -(METABASE_UPSERT_DAYS - 1));
  var toWrite = parsedRows.filter(function (r) {
    return r.activityDay >= minDay && r.activityDay <= cap;
  });
  if (!toWrite.length) {
    Logger.log('Daily upsert: 0 rows in window ' + minDay + ' .. ' + cap + '.');
    return 0;
  }
  var index = readDailyIndex_(sh);
  var updated = 0;
  toWrite.forEach(function (r) {
    var key = dailyKey_(r);
    var row = metabaseRowToDailyArray_(r);
    var rowNum = index[key] || (sh.getLastRow() + 1);
    if (!index[key]) index[key] = rowNum;
    sh.getRange(rowNum, 1, 1, METABASE_DAILY_HEADERS.length).setValues([row]);
    updated++;
  });
  SpreadsheetApp.flush();
  Logger.log('Daily tab upserted ' + updated + ' rows (window ' + minDay + ' .. ' + cap + ').');
  return updated;
}
function dailyKey_(r) {
  return r.activityDay + '|' + r.rooftopId + '|' + r.rooftopName + '|' + r.agentKey;
}
function metabaseRowToDailyArray_(r) {
  var a = r.callAttempts, e = r.engaged, q = r.qualified, p = r.appointments;
  return [
    r.activityDay,
    r.rooftopId,
    r.enterpriseName || '',
    r.rooftopName,
    agentLabelFromKey_(r.agentKey),
    a, e, q, p,
    ratioPct_(e, a),
    ratioPct_(q, e),
    ratioPct_(p, q),
  ];
}
function agentLabelFromKey_(key) {
  var map = { IB: 'Sales Inbound', OB: 'Sales Outbound', SvcIB: 'Service Inbound', SvcOB: 'Service Outbound' };
  return map[key] || key;
}
function ratioPct_(num, den) {
  return den > 0 ? Math.round((10000 * num) / den) / 10000 : '';
}
function readDailyIndex_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return {};
  var width = Math.max(sh.getLastColumn(), METABASE_DAILY_HEADERS.length);
  var numDataRows = last - 1;
  var values = numDataRows > 0 ? sh.getRange(2, 1, numDataRows, width).getValues() : [];
  var headers = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });
  var colDay = headers.indexOf('activity_day') >= 0 ? headers.indexOf('activity_day') : 0;
  var colEid = headers.indexOf('enterprise_id') >= 0 ? headers.indexOf('enterprise_id') : 1;
  var colRooftop = headers.indexOf('rooftop_name') >= 0 ? headers.indexOf('rooftop_name') : 3;
  var colAgent = headers.indexOf('agent') >= 0 ? headers.indexOf('agent') : 4;
  var tz = sh.getParent().getSpreadsheetTimeZone();
  var index = {};
  values.forEach(function (row, i) {
    var day = row[colDay];
    if (Object.prototype.toString.call(day) === '[object Date]') {
      day = Utilities.formatDate(day, tz, 'yyyy-MM-dd');
    } else {
      day = parseActivityDay_(day) || String(day).slice(0, 10);
    }
    var eid = String(row[colEid] || '').trim();
    var rooftop = String(row[colRooftop] || '').trim();
    var agent = String(row[colAgent] || '').trim();
    var agentKey = mapAgentKey_(agent) || agent;
    index[day + '|' + eid + '|' + rooftop + '|' + agentKey] = i + 2;
  });
  return index;
}
function mergeMetabaseRowsForLookback_(emailRows, asOf) {
  var fromDate = addDays_(asOf, -(LOOKBACK_DAYS - 1));
  var byKey = {};
  loadMetabaseRowsFromDailySheet_(fromDate, asOf).forEach(function (r) {
    byKey[dailyKey_(r)] = r;
  });
  (emailRows || []).forEach(function (r) {
    if (r.activityDay >= fromDate && r.activityDay <= asOf) byKey[dailyKey_(r)] = r;
  });
  return Object.keys(byKey).map(function (k) { return byKey[k]; });
}
function loadMetabaseRowsFromDailySheet_(fromDate, toDate) {
  var sh = setupSheets_().daily;
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = Math.max(sh.getLastColumn(), METABASE_DAILY_HEADERS.length);
  var numDataRows = last - 1;
  var values = numDataRows > 0 ? sh.getRange(2, 1, numDataRows, width).getValues() : [];
  var headers = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });
  var col = function (name, fallback) {
    var i = headers.indexOf(name);
    return i >= 0 ? i : fallback;
  };
  var colDay = col('activity_day', 0);
  var colEid = col('enterprise_id', 1);
  var colEnt = col('enterprise_name', 2);
  var colRooftop = col('rooftop_name', 3);
  var colAgent = col('agent', 4);
  var colA = col('call_attempts', 5);
  var colE = col('engaged', 6);
  var colQ = col('qualified', 7);
  var colP = col('appointments', 8);
  var tz = sh.getParent().getSpreadsheetTimeZone();
  var out = [];
  values.forEach(function (row) {
    var day = row[colDay];
    if (Object.prototype.toString.call(day) === '[object Date]') {
      day = Utilities.formatDate(day, tz, 'yyyy-MM-dd');
    } else {
      day = parseActivityDay_(day) || String(day).slice(0, 10);
    }
    if (!day || day < fromDate || day > toDate) return;
    var agentKey = mapAgentKey_(row[colAgent]);
    if (!agentKey) return;
    var rooftopName = String(row[colRooftop] || '').replace(/\s+/g, ' ').trim();
    if (!rooftopName) return;
    out.push(normalizeMetabaseRow_({
      activityDay: day,
      agentKey: agentKey,
      rooftopId: String(row[colEid] || '').trim() || rooftopName,
      rooftopName: rooftopName,
      enterpriseName: String(row[colEnt] || '').trim(),
      liveDate: '',
      csm: '',
      callAttempts: toNum_(row[colA]),
      engaged: toNum_(row[colE]),
      qualified: toNum_(row[colQ]),
      appointments: toNum_(row[colP]),
    }));
  });
  return out;
}
function appendAlertsToSheet_(alerts) {
  if (!alerts || !alerts.length) return 0;
  try {
    var sheets = setupSheets_();
    var sh = sheets.alerts;
    ensureAlertsHasCsmColumn_(sh);
    var existing = readAlertKeyIndex_(sh);
    var rows = [];
    alerts.forEach(function (a) {
      var agent = AGENT_SHORT[a.agentKey] || a.agentKey;
      var key = alertKey_(a.alertDate, agent, a.rooftopName, a.ruleId);
      var prev = existing[key];
      if (prev) {
        return;
      }
      var parsed = parseAlertDetail_(a.detail);
      rows.push([
        a.alertDate || '',
        agent,
        a.ruleId || '',
        a.rooftopId || '',
        a.rooftopName || '',
        parsed.value || a.detail || '',
        parsed.threshold || '',
        a.detail || '',
        '',
      ]);
      existing[key] = { row: sh.getLastRow() + rows.length, csm: '' };
    });
    if (!rows.length) return 0;
    var startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, rows.length, METABASE_ALERTS_HEADERS.length).setValues(rows);
    return rows.length;
  } catch (e) {
    Logger.log('appendAlertsToSheet_ failed: ' + e.message);
  }
  return 0;
}
function alertKey_(day, agent, rooftop, rule) {
  return normalizeSheetDay_(day) + '|' + agentLabelFromSheet_(agent) + '|' +
    normalizeNameKey_(rooftop) + '|' + String(rule || '').trim().toLowerCase();
}
function agentLabelFromSheet_(agent) {
  var key = mapAgentKey_(agent);
  return key ? (AGENT_SHORT[key] || key) : String(agent || '').trim();
}
function readAlertKeyIndex_(sh) {
  var index = {};
  var last = sh.getLastRow();
  if (last < 2) return index;
  var values = sh.getRange(2, 1, last - 1, METABASE_ALERTS_HEADERS.length).getValues();
  values.forEach(function (row, i) {
    var day = normalizeSheetDay_(row[0]);
    var notes = String(row[7] || '');
    if (!day || notes.indexOf('Metabase 4-file backfill') === 0) return;
    if (!String(row[1] || '').trim() || !String(row[2] || '').trim()) return;
    var csm = cleanCsm_(row[8]);
    var key = alertKey_(day, row[1], row[4], row[2]);
    var prev = index[key];
    if (!prev || (!prev.csm && csm)) index[key] = { row: i + 2, csm: csm };
  });
  return index;
}
function readExistingRealAlertDates_() {
  var sh = setupSheets_().alerts;
  var dates = {};
  var last = sh.getLastRow();
  if (last < 2) return dates;
  var values = sh.getRange(2, 1, last - 1, 8).getValues();
  values.forEach(function (row) {
    var day = normalizeSheetDay_(row[0]);
    var notes = String(row[7] || '');
    if (!day || notes.indexOf('Metabase 4-file backfill') === 0) return;
    if (!String(row[1] || '').trim()) return;
    dates[day] = true;
  });
  return dates;
}
function normalizeSheetDay_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, SHARED_TIMEZONE, 'yyyy-MM-dd');
  }
  var parsed = parseActivityDay_(value);
  return parsed || String(value || '').slice(0, 10);
}
function parseAlertDetail_(detail) {
  var s = String(detail || '');
  var m = s.match(/^(.+?)\s+\((.+)\)$/);
  if (m) return { value: m[1].trim(), threshold: m[2].trim() };
  return { value: s, threshold: '' };
}
function istDayOfWeek_() {
  return parseInt(Utilities.formatDate(new Date(), SHARED_TIMEZONE, 'u'), 10);
}
function calendarAsOf_() {
  var dow = istDayOfWeek_();
  var today = Utilities.formatDate(new Date(), SHARED_TIMEZONE, 'yyyy-MM-dd');
  // Sunday 3:30 AM IST is the Saturday mail. Write Saturday. Slack stays quiet on Sunday.
  if (dow === 7) return addDays_(today, -1);
  if (dow === 1) return addDays_(today, -2);
  return addDays_(today, -1);
}
function rowsHaveAttempts_(rows, day) {
  return (rows || []).some(function (r) {
    return r.activityDay === day && (r.callAttempts || 0) > 0;
  });
}
function latestWorkingDayWithData_(rows, cap) {
  var best = '';
  (rows || []).forEach(function (r) {
    if (!r.activityDay || r.activityDay > cap || !isWorkingDay_(r.activityDay)) return;
    if ((r.callAttempts || 0) <= 0) return;
    if (!best || r.activityDay > best) best = r.activityDay;
  });
  return best;
}
/** Report asOf: Mon → Sat; Tue–Sat → yesterday; if that day is not in the file, the latest day that is. */
function resolveReportAsOf_(rows, opts) {
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  var pinned = String(opts.asOf || props.getProperty('AS_OF') || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  var target = calendarAsOf_();
  if (!target) return null;
  if (rowsHaveAttempts_(rows, target)) return target;
  var fallback = latestWorkingDayWithData_(rows, target);
  if (fallback && fallback !== target) {
    Logger.log('As-of ' + target + ' is not in this email. Using ' + fallback + '.');
  }
  return fallback || target;
}
function shouldSkipSlackRunToday_() {
  return istDayOfWeek_() === 7;
}
function installViniAlertScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    EMAIL_FROM: 'metabase@spyne.ai',
    EMAIL_SUBJECT: 'VINI Accounts Alert daily rooftop metrics',
    ALERTS_FILL_SINCE: ALERTS_FILL_SINCE,
  });
  Logger.log('Script properties seeded (EMAIL_FROM, EMAIL_SUBJECT, ALERTS_FILL_SINCE).');
}
function verifyViniAlertCodeVersion() {
  if (String(VINI_SCRIPT_VERSION) !== '2026-10-17-mail-once-daily') {
    throw new Error('Wrong paste — expected 2026-10-17-mail-once-daily');
  }
  if (typeof catchUpMetabaseEmails !== 'function') throw new Error('Wrong paste — missing catchUpMetabaseEmails');
  if (typeof fillMissingAlertsFromDaily_ !== 'function') throw new Error('Wrong paste — missing fillMissingAlertsFromDaily_');
  if (typeof setupCsmSheet !== 'function') throw new Error('Wrong paste — missing setupCsmSheet');
  if (typeof logViniRun !== 'function') throw new Error('Wrong paste — missing logViniRun');
  Logger.log('OK — ' + VINI_SCRIPT_VERSION);
}
var TIMEZONE = SHARED_TIMEZONE;
var EMAIL_FROM = 'metabase@spyne.ai';
var EMAIL_SUBJECT = 'VINI Accounts Alert daily rooftop metrics';
var PROCESSED_LABEL = 'VINI-Alert-Processed';
var LOOKBACK_DAYS = 60;
var DATA_GUARD_MIN_RATIO = 0.3;
var AGENT_ORDER = ['IB', 'OB', 'SvcIB', 'SvcOB'];
var AGENT_SHORT = {
  IB: 'Sales IB',
  OB: 'Sales OB',
  SvcIB: 'Service IB',
  SvcOB: 'Service OB',
};
var CONNECT_FLOOR = { IB: 0.50, OB: 0.05, SvcIB: 0.50, SvcOB: 0.05 };
var DROP_PCT = { IB: 0.50, OB: 0.05, SvcIB: 0.50, SvcOB: 0.05 };
var BASELINE_WORKING_DAYS = 30;
var ATTEMPTS_FLOOR = { IB: 50, OB: 5, SvcIB: 50, SvcOB: 5 };
var IB_WINDOWS = {
  attempts: { consecutiveDays: 3, minPriorAttempts: 20 },
  engagedPct: { windowDays: 7, minAttempts: 20 },
  qualifiedPct: { windowDays: 7, minEngaged: 20 },
  apptRate: { windowDays: 7, minQualified: 30, minBaselineQualified: 20 },
};
var OB_WINDOWS = {
  attempts: { consecutiveDays: 1, minPriorAttempts: 20 },
  engagedPct: { windowDays: 3, minAttempts: 20 },
  qualifiedPct: { windowDays: 7, minEngaged: 20 },
  apptRate: { windowDays: 7, minQualified: 30, minBaselineQualified: 20 },
};
var THRESHOLDS = {
  IB: IB_WINDOWS,
  OB: OB_WINDOWS,
  SvcIB: JSON.parse(JSON.stringify(IB_WINDOWS)),
  SvcOB: JSON.parse(JSON.stringify(OB_WINDOWS)),
};
var CONFIG_NEW_BREACH_ONLY = true;
var REPORT_WORKING_DAYS = 1;
var LIVE_ACCOUNTS_SPREADSHEET_ID = '1KNSk0pdZIvv40N4dlIvtWcakXapcPS1Vhlo9E8S8wbI';
var LIVE_ACCOUNTS_GID = 699048576;

function setupDailyTrigger() {
  deleteTriggers_('processLatestMetabaseEmail');
  // 22:00 UTC is 3:30 AM IST. The 4:00 AM IST hour is the first full hour after that mail.
  ScriptApp.newTrigger('processLatestMetabaseEmail')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .inTimezone(SHARED_TIMEZONE)
    .create();
  Logger.log('Daily trigger: processLatestMetabaseEmail at 4:00 AM IST, after the 22:00 UTC Metabase mail. No hourly write.');
}
function setupSlackDailyTrigger() {
  setupDailyTrigger();
}
function processLatestMetabaseEmail() {
  runEmailJob_({
    markProcessed: true,
    skipProcessed: true,
    limit: 5,
    logWhenEmpty: false,
    runLabel: 'processLatestMetabaseEmail',
  });
}
function testWithLatestEmail() {
  runEmailJob_({ markProcessed: false, skipProcessed: false, limit: 1, runLabel: 'testWithLatestEmail' });
  fillMissingAlertsFromDaily_();
}
function testReportSep28() {
  runEmailJob_({ markProcessed: false, skipProcessed: false, asOf: '2026-09-28', limit: 1, runLabel: 'testReportSep28' });
}
function catchUpMetabaseEmails() {
  var since = ALERTS_FILL_SINCE;
  runEmailJob_({
    markProcessed: true,
    skipProcessed: false,
    limit: 15,
    minDay: since,
    queryExtra: ' after:2026/10/11',
    runLabel: 'catchUpMetabaseEmails',
  });
  fillMissingAlertsFromDaily_(true);
}
function shouldReopenLabeled_() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), SHARED_TIMEZONE, 'yyyy-MM-dd');
  if (props.getProperty('LABELED_REREAD_DAY') === today) return false;
  props.setProperty('LABELED_REREAD_DAY', today);
  return true;
}
function runEmailJob_(opts) {
  opts = opts || {};
  var threads = findEmailThreads_(opts.skipProcessed !== false, opts.limit || 10, opts.queryExtra || '');
  if (!threads.length) {
    Logger.log('No Metabase email matched this search.');
    if (opts.logWhenEmpty !== false) {
      logViniRun({
        run: opts.runLabel || 'runEmailJob_',
        asOf: '',
        dailyUpserted: '',
        alertsAppended: '',
        status: 'Skipped',
        notes: 'No Metabase email matched' + (opts.skipProcessed === false ? ' (labeled mail included)' : ''),
      });
    }
    return;
  }
  threads.forEach(function (thread) {
    processOneThread_(thread, opts);
  });
}
function processOneThread_(thread, opts) {
  var runLabel = opts.runLabel || 'processOneThread_';
  var messages = thread.getMessages();
  var message = messages[messages.length - 1];
  var messageId = message.getId();
  var rows;
  try {
    rows = parseEmailAttachment_(thread);
  } catch (e) {
    Logger.log('Attachment parse failed: ' + e.message);
    logViniRun({
      run: runLabel, asOf: '', dailyUpserted: '', alertsAppended: '',
      status: 'Failed', notes: 'Could not parse attachment: ' + e.message,
    });
    return;
  }
  if (!rows.length) {
    logViniRun({
      run: runLabel, asOf: '', dailyUpserted: '', alertsAppended: '',
      status: 'Failed', notes: 'Attachment had no activity rows. Not labeled. ' + messageId,
    });
    return;
  }
  var span = activitySpan_(rows);
  var dailyCount = upsertMetabaseRowsToDaily_(rows, { minDay: opts.minDay });
  if (opts.markProcessed) markEmailProcessed_(thread, messageId);
  var asOf = resolveReportAsOf_(rows, opts);
  if (!asOf) {
    logViniRun({
      run: runLabel, asOf: '', dailyUpserted: dailyCount, alertsAppended: 0,
      status: 'Done', notes: 'Daily upsert ' + dailyCount + ' (' + span + '); no alert asOf',
    });
    return;
  }
  var rowsForRules = mergeMetabaseRowsForLookback_(rows, asOf);
  var grouped = groupMetabaseRows_(rowsForRules, asOf);
  enrichGroupedLiveDates_(grouped, loadLiveAccountsLookup_());
  if (!dayIsCompleteEnough_(grouped, asOf)) {
    var totalAttempts = 0;
    AGENT_ORDER.forEach(function (k) { totalAttempts += networkAttempts_(grouped, k, asOf); });
    var thinNote = 'Daily upsert ' + dailyCount + ' rows (' + span + '); Alerts not written for ' +
      asOf + ' (' + totalAttempts + ' attempts; under ' + INCOMPLETE_ATTEMPT_FLOOR +
      ' or fewer than 3 agents stays open).';
    Logger.log(thinNote);
    logViniRun({
      run: runLabel, asOf: asOf, dailyUpserted: dailyCount, alertsAppended: 0,
      status: 'Partial', notes: thinNote,
    });
    return;
  }
  var silent = AGENT_ORDER.filter(function (k) { return networkAttempts_(grouped, k, asOf) <= 0; });
  var alerts = evaluateReportWindow_(grouped, asOf);
  enrichAlertsCsm_(alerts, loadCsmLookup_());
  var alertCount = appendAlertsToSheet_(alerts);
  var note = 'Daily upsert ' + dailyCount + ' rows (' + span + '); Alerts appended ' + alertCount + ' for asOf ' + asOf;
  if (silent.length) note += '; no attempts for ' + silent.map(function (k) { return AGENT_SHORT[k]; }).join(', ');
  Logger.log(note);
  logViniRun({
    run: runLabel, asOf: asOf, dailyUpserted: dailyCount, alertsAppended: alertCount,
    status: alertCount || !silent.length ? 'Done' : 'Partial', notes: note,
  });
}
function activitySpan_(rows) {
  var days = (rows || []).map(function (r) { return r.activityDay; }).filter(Boolean).sort();
  if (!days.length) return 'no days';
  return days[0] + '..' + days[days.length - 1] + ', ' + rows.length + ' attachment rows';
}
function findEmailThreads_(skipProcessed, limit, queryExtra) {
  var q = 'from:' + EMAIL_FROM + ' subject:"' + EMAIL_SUBJECT + '" has:attachment' + (queryExtra || '');
  if (skipProcessed) q += ' -label:' + PROCESSED_LABEL;
  var threads = GmailApp.search(q, 0, limit || 10);
  return threads.slice().reverse();
}
function fillMissingAlertsFromDaily_(forceLog) {
  if (istDayOfWeek_() === 7) {
    Logger.log('Sunday — Daily can update. Alerts are not created. Monday uses Saturday.');
    return;
  }
  var since = PropertiesService.getScriptProperties().getProperty('ALERTS_FILL_SINCE') || ALERTS_FILL_SINCE;
  var yesterday = yesterdayIst_();
  var existing = readExistingRealAlertDates_();
  var props = PropertiesService.getScriptProperties();
  var evaluated = (props.getProperty('ALERTS_EVALUATED_DAYS') || '').split(',').filter(Boolean);
  var filled = [];
  var open = [];
  var cur = since;
  while (cur <= yesterday) {
    if (isWorkingDay_(cur) && !existing[cur] && evaluated.indexOf(cur) < 0) {
      var outcome = appendAlertsForDayFromDaily_(cur);
      if (outcome.added > 0) filled.push(cur + ':' + outcome.added);
      else if (outcome.done) evaluated.push(cur);
      else open.push(cur + ' ' + outcome.reason);
    }
    cur = addDays_(cur, 1);
  }
  props.setProperty('ALERTS_EVALUATED_DAYS', evaluated.join(','));
  var notes = [];
  if (filled.length) notes.push('Filled ' + filled.join(', '));
  if (open.length) notes.push('Still open: ' + open.join(', '));
  var signature = notes.join(' | ');
  var previous = props.getProperty('FILL_NOTE') || '';
  if (!signature) return;
  if (!forceLog && signature === previous && !filled.length) return;
  props.setProperty('FILL_NOTE', signature);
  var added = 0;
  filled.forEach(function (item) { added += Number(item.split(':')[1]) || 0; });
  logViniRun({
    run: 'fillMissingAlertsFromDaily_',
    asOf: filled.length ? filled.join(', ') : since + '..' + yesterday,
    dailyUpserted: '',
    alertsAppended: added,
    status: filled.length ? 'Done' : 'Partial',
    notes: signature,
  });
}
function appendAlertsForDayFromDaily_(day) {
  var rows = loadMetabaseRowsFromDailySheet_(addDays_(day, -(LOOKBACK_DAYS - 1)), day);
  var grouped = groupMetabaseRows_(rows, day);
  if (!dayIsCompleteEnough_(grouped, day)) {
    var total = 0;
    AGENT_ORDER.forEach(function (k) { total += networkAttempts_(grouped, k, day); });
    return { added: 0, done: false, reason: 'incomplete ' + total + ' attempts' };
  }
  var liveLookup = loadLiveAccountsLookup_();
  enrichGroupedLiveDates_(grouped, liveLookup);
  if (countEligible_(grouped, day) === 0) {
    return { added: 0, done: false, reason: 'no live_date' };
  }
  var alerts = evaluateReportWindow_(grouped, day);
  enrichAlertsCsm_(alerts, loadCsmLookup_());
  var added = appendAlertsToSheet_(alerts);
  return { added: added, done: true, reason: 'rules=' + added };
}
function dayIsCompleteEnough_(grouped, asOf) {
  var agents = 0;
  var total = 0;
  AGENT_ORDER.forEach(function (k) {
    var n = networkAttempts_(grouped, k, asOf);
    if (n > 0) agents++;
    total += n;
  });
  return agents >= 3 && total >= INCOMPLETE_ATTEMPT_FLOOR;
}
function dailyHasCompleteDay_(day) {
  if (!day) return false;
  var rows = loadMetabaseRowsFromDailySheet_(day, day);
  var grouped = groupMetabaseRows_(rows, day);
  return dayIsCompleteEnough_(grouped, day);
}
function countEligible_(grouped, asOf) {
  var n = 0;
  AGENT_ORDER.forEach(function (k) {
    Object.keys(grouped[k] || {}).forEach(function (id) {
      if (isRooftopEligibleForAlerts_(grouped[k][id], asOf)) n++;
    });
  });
  return n;
}

function findLatestEmailThread_(skipProcessed) {
  var threads = findEmailThreads_(skipProcessed, 1, '');
  return threads.length ? threads[threads.length - 1] : null;
}
function parseEmailAttachment_(thread) {
  var messages = thread.getMessages();
  for (var m = 0; m < messages.length; m++) {
    var atts = messages[m].getAttachments();
    for (var a = 0; a < atts.length; a++) {
      var rows = attachmentToRows_(atts[a]);
      if (rows.length) return rows;
    }
  }
  return [];
}
function attachmentToRows_(att) {
  var name = att.getName().toLowerCase();
  var type = String(att.getContentType() || '').toLowerCase();
  if (name.indexOf('.csv') >= 0 || type.indexOf('csv') >= 0) return csvToRows_(att);
  if (name.indexOf('.xlsx') >= 0 || name.indexOf('.xls') >= 0 ||
      type.indexOf('spreadsheet') >= 0 || type.indexOf('excel') >= 0) {
    return xlsxToRows_(att);
  }
  return [];
}
function csvToRows_(blob) {
  var text = blob.getDataAsString('UTF-8').replace(/^\uFEFF/, '');
  var lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  var headers = normalizeHeaders_(splitCsvLine_(lines[0]));
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    var cells = splitCsvLine_(lines[i]);
    var row = rowToObject_(headers, cells);
    if (row) rows.push(row);
  }
  return rows;
}
function splitCsvLine_(line) {
  var out = [];
  var cur = '';
  var q = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
function xlsxToRows_(blob) {
  var tempName = 'vini-metabase-' + Date.now();
  var file = Drive.Files.insert(
    { title: tempName, mimeType: MimeType.GOOGLE_SHEETS },
    blob,
    { convert: true }
  );
  try {
    var sheet = SpreadsheetApp.openById(file.id).getSheets()[0];
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];
    var headers = normalizeHeaders_(values[0]);
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = rowToObject_(headers, values[r]);
      if (row) rows.push(row);
    }
    return rows;
  } finally {
    Drive.Files.remove(file.id);
  }
}
function markEmailProcessed_(thread, messageId) {
  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
  thread.addLabel(label);
  rememberProcessedId_(messageId);
}
function isMessageProcessed_(messageId) {
  var raw = PropertiesService.getScriptProperties().getProperty('PROCESSED_MESSAGE_IDS');
  if (!raw) return false;
  try { return JSON.parse(raw).indexOf(messageId) >= 0; } catch (e) { return false; }
}
function rememberProcessedId_(messageId) {
  var props = PropertiesService.getScriptProperties();
  var ids = [];
  try { ids = JSON.parse(props.getProperty('PROCESSED_MESSAGE_IDS') || '[]'); } catch (e) { ids = []; }
  if (ids.indexOf(messageId) < 0) ids.unshift(messageId);
  props.setProperty('PROCESSED_MESSAGE_IDS', JSON.stringify(ids.slice(0, 100)));
}
function normalizeHeaders_(headerRow) {
  return headerRow.map(function (h) {
    return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
  });
}
function rowToObject_(headers, cells) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) obj[headers[i]] = cells[i];
  }
  var day = parseActivityDay_(obj.activity_day || obj.activity_date || obj.date);
  if (!day) return null;
  var agentKey = mapAgentKey_(obj.agent || obj.agent_type);
  if (!agentKey) return null;
  var rooftopName = String(obj.rooftop_name || obj.rooftop || '').replace(/\s+/g, ' ').trim();
  if (!rooftopName) return null;
  var rooftopId = String(obj.enterprise_id || obj.rooftop_id || obj.team_id || rooftopName).trim();
  var liveDate = parseActivityDay_(obj.live_date || obj.agent_live_date || obj.go_live_date || obj.rooftop_live_date || '');
  return normalizeMetabaseRow_({
    activityDay: day,
    agentKey: agentKey,
    rooftopId: rooftopId,
    rooftopName: rooftopName,
    enterpriseName: String(obj.enterprise_name || '').trim(),
    liveDate: liveDate || '',
    csm: String(obj.csm || obj.csm_email || obj.cs_poc_email || obj.csm_owner || obj.account_owner || '').trim(),
    callAttempts: toNum_(obj.call_attempts || obj.attempts || obj.call_attempt),
    engaged: toNum_(obj.engaged),
    qualified: toNum_(obj.qualified),
    appointments: toNum_(obj.appointments || obj.appts || obj.appointment),
  });
}
function normalizeMetabaseRow_(row) {
  return {
    activityDay: row.activityDay,
    agentKey: row.agentKey,
    rooftopId: row.rooftopId,
    rooftopName: row.rooftopName,
    enterpriseName: row.enterpriseName,
    liveDate: row.liveDate || '',
    csm: row.csm || '',
    callAttempts: Math.max(0, row.callAttempts || 0),
    engaged: Math.max(0, row.engaged || 0),
    qualified: Math.max(0, row.qualified || 0),
    appointments: Math.max(0, row.appointments || 0),
  };
}
function parseActivityDay_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd');
  }
  if (typeof value === 'number' && value > 20000) {
    var epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(value));
    return epoch.toISOString().slice(0, 10);
  }
  var s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var m = s.match(/^(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})$/);
  if (m) return isoFromParts_(parseInt(m[3], 10), m[2], parseInt(m[1], 10));
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) return isoFromParts_(parseInt(m[3], 10), m[1], parseInt(m[2], 10));
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
  return null;
}
function isoFromParts_(year, monStr, day) {
  var months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var mon = months[String(monStr).slice(0, 3).toLowerCase()];
  if (mon === undefined) return null;
  var d = new Date(Date.UTC(year, mon, day));
  return d.toISOString().slice(0, 10);
}
function mapAgentKey_(raw) {
  var s = String(raw || '').trim().toLowerCase();
  if (s.indexOf('sales') >= 0 && s.indexOf('inbound') >= 0) return 'IB';
  if (s.indexOf('sales') >= 0 && s.indexOf('outbound') >= 0) return 'OB';
  if (s.indexOf('service') >= 0 && s.indexOf('inbound') >= 0) return 'SvcIB';
  if (s.indexOf('service') >= 0 && s.indexOf('outbound') >= 0) return 'SvcOB';
  return null;
}
function groupMetabaseRows_(rows, asOf) {
  var fromDate = addDays_(asOf, -(LOOKBACK_DAYS - 1));
  var grouped = {};
  AGENT_ORDER.forEach(function (k) { grouped[k] = {}; });
  rows.forEach(function (row) {
    if (row.activityDay < fromDate || row.activityDay > asOf) return;
    var agent = grouped[row.agentKey];
    if (!agent) return;
    if (!agent[row.rooftopId]) {
      agent[row.rooftopId] = { name: row.rooftopName, liveDate: row.liveDate || '', csm: row.csm || '', days: {} };
    }
    if (row.liveDate && (!agent[row.rooftopId].liveDate || row.liveDate < agent[row.rooftopId].liveDate)) {
      agent[row.rooftopId].liveDate = row.liveDate;
    }
    if (row.csm && !agent[row.rooftopId].csm) agent[row.rooftopId].csm = row.csm;
    var slot = agent[row.rooftopId].days[row.activityDay] || { a: 0, e: 0, q: 0, p: 0 };
    slot.a += row.callAttempts;
    slot.e += row.engaged;
    slot.q += row.qualified;
    slot.p += row.appointments;
    agent[row.rooftopId].days[row.activityDay] = slot;
  });
  return grouped;
}
function resolveAsOf_(rows, opts) {
  return resolveReportAsOf_(rows, opts);
}
function hasCompleteAgentData_(rows, asOf) {
  var seen = {};
  rows.forEach(function (r) {
    if (r.activityDay !== asOf) return;
    if (r.callAttempts > 0 || r.engaged > 0) seen[r.agentKey] = true;
  });
  return AGENT_ORDER.every(function (k) { return seen[k]; });
}
function latestCompleteAsOf_(rows, cap) {
  var byDay = {};
  rows.forEach(function (r) {
    if (r.activityDay > cap) return;
    if (!byDay[r.activityDay]) byDay[r.activityDay] = {};
    if (r.callAttempts > 0 || r.engaged > 0) byDay[r.activityDay][r.agentKey] = true;
  });
  var best = '';
  Object.keys(byDay).sort().forEach(function (d) {
    if (AGENT_ORDER.every(function (k) { return byDay[d][k]; })) best = d;
  });
  return best;
}
function isWorkingDay_(iso) {
  var d = new Date(iso + 'T12:00:00Z');
  return d.getUTCDay() !== 0;
}
function workingDaysBefore_(iso, count) {
  var out = [];
  var cur = addDays_(iso, -1);
  while (out.length < count) {
    if (isWorkingDay_(cur)) out.push(cur);
    cur = addDays_(cur, -1);
  }
  return out;
}
function getUsHolidays_(year) {
  var cacheKey = 'US_HOLIDAYS_' + year;
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  var list = computeUsFederalHolidays_(year);
  props.setProperty(cacheKey, JSON.stringify(list));
  return list;
}
function computeUsFederalHolidays_(year) {
  var observed = function (y, m, d) {
    var dt = new Date(Date.UTC(y, m, d));
    var dow = dt.getUTCDay();
    if (dow === 6) return addDays_(dt.toISOString().slice(0, 10), -1);
    if (dow === 0) return addDays_(dt.toISOString().slice(0, 10), 1);
    return dt.toISOString().slice(0, 10);
  };
  var nthWeekday = function (y, m, n, weekday) {
    var count = 0;
    for (var d = 1; d <= 31; d++) {
      var dt = new Date(Date.UTC(y, m, d));
      if (dt.getUTCMonth() !== m) break;
      if (dt.getUTCDay() === weekday) {
        count++;
        if (count === n) return dt.toISOString().slice(0, 10);
      }
    }
    return null;
  };
  var lastWeekday = function (y, m, weekday) {
    var last = null;
    for (var d = 1; d <= 31; d++) {
      var dt = new Date(Date.UTC(y, m, d));
      if (dt.getUTCMonth() !== m) break;
      if (dt.getUTCDay() === weekday) last = dt.toISOString().slice(0, 10);
    }
    return last;
  };
  return [
    observed(year, 0, 1), nthWeekday(year, 0, 3, 1), nthWeekday(year, 1, 3, 1),
    lastWeekday(year, 4, 1), observed(year, 5, 19), observed(year, 6, 4),
    nthWeekday(year, 8, 1, 1), nthWeekday(year, 9, 2, 1), observed(year, 10, 11),
    nthWeekday(year, 10, 4, 4), observed(year, 11, 25),
  ].filter(Boolean);
}
/** Not called. One silent agent must not cancel the day. evaluateDay_ skips that agent. */
function dataChecks_(grouped, asOf) {
  var missing = [];
  for (var i = 0; i < AGENT_ORDER.length; i++) {
    var key = AGENT_ORDER[i];
    if (networkAttempts_(grouped, key, asOf) <= 0) missing.push(AGENT_SHORT[key]);
  }
  if (missing.length === AGENT_ORDER.length) return { ok: false, reason: 'no attempts on ' + asOf };
  return { ok: true, missing: missing };
}
function dataGuardOk_(grouped, agentKey, asOf) {
  var today = networkAttempts_(grouped, agentKey, asOf);
  var days = workingDaysBefore_(asOf, 7);
  var sum = 0;
  days.forEach(function (d) { sum += networkAttempts_(grouped, agentKey, d); });
  var avg = days.length ? sum / days.length : 0;
  if (avg <= 0) return true;
  return today >= DATA_GUARD_MIN_RATIO * avg;
}
function networkAttempts_(grouped, agentKey, iso) {
  var total = 0;
  var rooftops = grouped[agentKey] || {};
  Object.keys(rooftops).forEach(function (id) {
    var day = rooftops[id].days[iso];
    if (day) total += day.a;
  });
  return total;
}
function evaluateDay_(grouped, asOf) {
  if (!isWorkingDay_(asOf)) return [];
  var alerts = [];
  AGENT_ORDER.forEach(function (agentKey) {
    if (networkAttempts_(grouped, agentKey, asOf) <= 0) return;
    var cfg = THRESHOLDS[agentKey];
    var connectFloor = CONNECT_FLOOR[agentKey];
    var dropPct = DROP_PCT[agentKey];
    var attemptsFloor = ATTEMPTS_FLOOR[agentKey];
    var rooftops = grouped[agentKey] || {};
    var rule1Allowed = dataGuardOk_(grouped, agentKey, asOf);
    Object.keys(rooftops).forEach(function (rooftopId) {
      var rt = rooftops[rooftopId];
      if (!isRooftopEligibleForAlerts_(rt, asOf)) return;
      if (rule1Allowed && checkAttemptsLow_(rt, asOf, cfg.attempts, attemptsFloor)) {
        alerts.push(makeAlert_(agentKey, rooftopId, rt, 'attempts_low', formatAttemptsLow_(rt, asOf, cfg.attempts, attemptsFloor)));
      }
      if (checkConnectsPct_(rt, asOf, cfg.engagedPct, connectFloor)) {
        alerts.push(makeAlert_(agentKey, rooftopId, rt, 'engaged_pct', formatConnectsLow_(rt, asOf, cfg.engagedPct, connectFloor)));
      }
      if (checkQualifiedPct_(rt, asOf, cfg.qualifiedPct, dropPct)) {
        alerts.push(makeAlert_(agentKey, rooftopId, rt, 'qualified_pct', formatQualifiedDrop_(rt, asOf, cfg.qualifiedPct)));
      }
      if (cfg.apptRate && checkApptRate_(rt, asOf, cfg.apptRate, dropPct)) {
        alerts.push(makeAlert_(agentKey, rooftopId, rt, 'appt_rate', formatApptDrop_(rt, asOf, cfg.apptRate)));
      }
    });
  });
  return alerts;
}
function makeAlert_(agentKey, rooftopId, rt, ruleId, detail) {
  return {
    agentKey: agentKey, rooftopId: rooftopId, rooftopName: rt.name, csm: rt.csm || '',
    ruleId: ruleId, metric: metricLabelForRuleId_(ruleId),
    breachKey: agentKey + '|' + rooftopId + '|' + ruleId, detail: detail,
  };
}
function metricLabelForRuleId_(ruleId) {
  if (ruleId === 'attempts_low') return 'Attempts';
  if (ruleId === 'engaged_pct') return 'Connects';
  if (ruleId === 'qualified_pct') return 'Qualified';
  if (ruleId === 'appt_rate') return 'Appt';
  return ruleId;
}
function filterNewBreachesOnly_(todayAlerts, prevAlerts) {
  var prevKeys = {};
  prevAlerts.forEach(function (a) { prevKeys[a.breachKey] = true; });
  return todayAlerts.filter(function (a) { return !prevKeys[a.breachKey]; });
}
function evaluateReportWindow_(grouped, asOf) {
  var days = lastNWorkingDaysIncluding_(asOf, REPORT_WORKING_DAYS);
  var allAlerts = [];
  days.forEach(function (day) {
    var dayAlerts = evaluateDay_(grouped, day);
    if (CONFIG_NEW_BREACH_ONLY) {
      var prevDay = previousWorkingDay_(day);
      dayAlerts = filterNewBreachesOnly_(dayAlerts, evaluateDay_(grouped, prevDay));
    }
    dayAlerts.forEach(function (a) { a.alertDate = day; });
    allAlerts = allAlerts.concat(dayAlerts);
  });
  return allAlerts;
}
function lastNWorkingDaysIncluding_(asOf, count) {
  var out = [];
  var cur = asOf;
  while (out.length < count) {
    if (isWorkingDay_(cur)) out.unshift(cur);
    if (out.length >= count) break;
    cur = previousWorkingDay_(cur);
  }
  return out;
}
function metric_(rt, iso, field) {
  var d = rt.days[iso];
  return d ? d[field] : 0;
}
function windowSum_(rt, endIso, field, days) {
  var total = 0;
  for (var i = 0; i < days; i++) total += metric_(rt, addDays_(endIso, -i), field);
  return total;
}
function workingDaysSum_(rt, workingDayList, field) {
  var total = 0;
  workingDayList.forEach(function (d) { total += metric_(rt, d, field); });
  return total;
}
function baselineWorkingDaysBeforeWindow_(asOf, windowDays) {
  var windowStart = addDays_(asOf, -(windowDays - 1));
  return workingDaysBefore_(windowStart, BASELINE_WORKING_DAYS);
}
function isRooftopEligibleForAlerts_(rt, asOf) {
  if (!rt.liveDate) return false;
  return asOf >= rt.liveDate;
}
function collectConsecutiveWorkingDays_(asOf, count) {
  var out = [];
  var cur = asOf;
  while (out.length < count) {
    if (!isWorkingDay_(cur)) return [];
    out.push(cur);
    cur = previousWorkingDay_(cur);
  }
  return out;
}
function hadPriorVolume_(rt, beforeIso, minAttempts) {
  var days = workingDaysBefore_(beforeIso, 7);
  var sum = 0;
  days.forEach(function (d) { sum += metric_(rt, d, 'a'); });
  return sum >= minAttempts;
}
function checkAttemptsLow_(rt, asOf, cfg, floor) {
  if (!hadPriorVolume_(rt, asOf, cfg.minPriorAttempts)) return false;
  var runDays = collectConsecutiveWorkingDays_(asOf, cfg.consecutiveDays);
  if (runDays.length < cfg.consecutiveDays) return false;
  return runDays.every(function (d) { return metric_(rt, d, 'a') < floor; });
}
function checkConnectsPct_(rt, asOf, cfg, floor) {
  var attempts = windowSum_(rt, asOf, 'a', cfg.windowDays);
  if (attempts < cfg.minAttempts) return false;
  var engaged = windowSum_(rt, asOf, 'e', cfg.windowDays);
  return (engaged / attempts) < floor;
}
function checkQualifiedPct_(rt, asOf, cfg, dropPct) {
  var engaged = windowSum_(rt, asOf, 'e', cfg.windowDays);
  if (engaged < cfg.minEngaged) return false;
  var qualified = windowSum_(rt, asOf, 'q', cfg.windowDays);
  var winRate = qualified / engaged;
  var baselineDays = baselineWorkingDaysBeforeWindow_(asOf, cfg.windowDays);
  if (baselineDays.length < BASELINE_WORKING_DAYS) return false;
  var baseEngaged = workingDaysSum_(rt, baselineDays, 'e');
  if (baseEngaged < cfg.minEngaged) return false;
  var baseQualified = workingDaysSum_(rt, baselineDays, 'q');
  var baseRate = baseQualified / baseEngaged;
  if (baseRate <= 0) return false;
  return winRate <= (1 - dropPct) * baseRate;
}
function checkApptRate_(rt, asOf, cfg, dropPct) {
  var qualified = windowSum_(rt, asOf, 'q', cfg.windowDays);
  if (qualified < cfg.minQualified) return false;
  var winRate = windowSum_(rt, asOf, 'p', cfg.windowDays) / qualified;
  var baselineDays = baselineWorkingDaysBeforeWindow_(asOf, cfg.windowDays);
  if (baselineDays.length < BASELINE_WORKING_DAYS) return false;
  var baseQualified = workingDaysSum_(rt, baselineDays, 'q');
  if (baseQualified < cfg.minBaselineQualified) return false;
  var baseRate = workingDaysSum_(rt, baselineDays, 'p') / baseQualified;
  if (baseRate <= 0) return false;
  return winRate <= (1 - dropPct) * baseRate;
}
function formatAttemptsLow_(rt, asOf, cfg, floor) {
  var runDays = collectConsecutiveWorkingDays_(asOf, cfg.consecutiveDays);
  var attempts = runDays.map(function (d) { return metric_(rt, d, 'a'); });
  if (cfg.consecutiveDays > 1) return attempts.join('/') + ' (<' + floor + '/day)';
  return attempts[0] + ' (<' + floor + '/day)';
}
function formatConnectsLow_(rt, asOf, cfg, floor) {
  var attempts = windowSum_(rt, asOf, 'a', cfg.windowDays);
  var engaged = windowSum_(rt, asOf, 'e', cfg.windowDays);
  var pct = attempts > 0 ? Math.round((1000 * engaged) / attempts) / 10 : 0;
  var floorPct = Math.round(floor * 1000) / 10;
  return pct + '% (<' + floorPct + '%)';
}
function formatQualifiedDrop_(rt, asOf, cfg) {
  var engaged = windowSum_(rt, asOf, 'e', cfg.windowDays);
  var qualified = windowSum_(rt, asOf, 'q', cfg.windowDays);
  var pct = engaged > 0 ? Math.round((1000 * qualified) / engaged) / 10 : 0;
  var baselineDays = baselineWorkingDaysBeforeWindow_(asOf, cfg.windowDays);
  var baseEngaged = workingDaysSum_(rt, baselineDays, 'e');
  var baseQualified = workingDaysSum_(rt, baselineDays, 'q');
  var basePct = baseEngaged > 0 ? Math.round((1000 * baseQualified) / baseEngaged) / 10 : 0;
  return pct + '% (baseline ' + basePct + '%)';
}
function formatApptDrop_(rt, asOf, cfg) {
  var qualified = windowSum_(rt, asOf, 'q', cfg.windowDays);
  var appts = windowSum_(rt, asOf, 'p', cfg.windowDays);
  var pct = qualified > 0 ? Math.round((1000 * appts) / qualified) / 10 : 0;
  var baselineDays = baselineWorkingDaysBeforeWindow_(asOf, cfg.windowDays);
  var baseQualified = workingDaysSum_(rt, baselineDays, 'q');
  var baseAppts = workingDaysSum_(rt, baselineDays, 'p');
  var basePct = baseQualified > 0 ? Math.round((1000 * baseAppts) / baseQualified) / 10 : 0;
  return pct + '% (baseline ' + basePct + '%)';
}
function loadLiveAccountsLookup_() {
  var lookup = { byTeamId: {}, byEnterpriseId: {}, byComposite: {} };
  try {
    var ss = SpreadsheetApp.openById(LIVE_ACCOUNTS_SPREADSHEET_ID);
    var sheet = getSheetByGidOrName_(ss, LIVE_ACCOUNTS_GID, 'Live accounts');
    if (!sheet) return lookup;
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return lookup;
    var colIdx = buildLiveAccountsColIdx_(values[0]);
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var entId = colIdx.enterprise_id !== undefined ? String(row[colIdx.enterprise_id] || '').trim() : '';
      var teamId = colIdx.team_id !== undefined ? String(row[colIdx.team_id] || '').trim() : '';
      var acct = colIdx.account !== undefined ? String(row[colIdx.account] || '').trim() : '';
      var liveRaw = colIdx.live_date !== undefined ? row[colIdx.live_date] : '';
      var liveDate = parseActivityDay_(liveRaw);
      if (!liveDate) continue;
      if (teamId && !lookup.byTeamId[teamId]) lookup.byTeamId[teamId] = liveDate;
      if (entId && !lookup.byEnterpriseId[entId]) lookup.byEnterpriseId[entId] = liveDate;
      var normName = normalizeNameKey_(acct);
      if (entId && normName) lookup.byComposite[entId + '|' + normName] = liveDate;
    }
  } catch (e) {
    Logger.log('loadLiveAccountsLookup_ failed: ' + e.message);
  }
  return lookup;
}
function enrichGroupedLiveDates_(grouped, lookup) {
  AGENT_ORDER.forEach(function (agentKey) {
    var rooftops = grouped[agentKey] || {};
    Object.keys(rooftops).forEach(function (rooftopId) {
      var rt = rooftops[rooftopId];
      if (rt.liveDate) return;
      var liveDate = resolveLiveDate_(rooftopId, rt.name, lookup);
      if (liveDate) rt.liveDate = liveDate;
    });
  });
}
function resolveLiveDate_(rooftopId, rooftopName, lookup) {
  var id = String(rooftopId || '').trim();
  var normName = normalizeNameKey_(rooftopName);
  if (id && lookup.byTeamId[id]) return lookup.byTeamId[id];
  if (id && lookup.byEnterpriseId[id]) return lookup.byEnterpriseId[id];
  if (id && normName && lookup.byComposite[id + '|' + normName]) return lookup.byComposite[id + '|' + normName];
  return '';
}
function loadCsmLookup_() {
  var lookup = { byId: {}, byName: {}, byComposite: {} };
  try {
    var ss = SpreadsheetApp.openById(LIVE_ACCOUNTS_SPREADSHEET_ID);
    var sheet = getSheetByGidOrName_(ss, LIVE_ACCOUNTS_GID, 'Live accounts');
    if (!sheet) return lookup;
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return lookup;
    var colIdx = buildLiveAccountsColIdx_(values[0]);
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var entId = colIdx.enterprise_id !== undefined ? String(row[colIdx.enterprise_id] || '').trim() : '';
      var acct = colIdx.account !== undefined ? String(row[colIdx.account] || '').trim() : '';
      var csm = colIdx.cs_poc_email !== undefined ? String(row[colIdx.cs_poc_email] || '').trim() : '';
      if (!csm) continue;
      if (entId && !lookup.byId[entId]) lookup.byId[entId] = csm;
      var normName = normalizeNameKey_(acct);
      if (normName && !lookup.byName[normName]) lookup.byName[normName] = csm;
      if (entId && normName) lookup.byComposite[entId + '|' + normName] = csm;
    }
  } catch (e) {
    Logger.log('loadCsmLookup_ failed: ' + e.message);
  }
  return lookup;
}
function buildLiveAccountsColIdx_(headerRow) {
  var idx = {};
  for (var c = 0; c < headerRow.length; c++) {
    var lower = String(headerRow[c] || '').trim().toLowerCase();
    if (lower === 'enterprise id' || lower === 'enterprise_id') idx.enterprise_id = c;
    if (lower === 'team id' || lower === 'team_id' || lower === 'rooftop id' || lower === 'rooftop_id') {
      if (idx.team_id === undefined) idx.team_id = c;
    }
    if (lower === 'account' || lower === 'account name' || lower === 'entity name') {
      if (idx.account === undefined) idx.account = c;
    }
    if (lower === 'live date' || lower === 'live_date' || lower === 'go live date' || lower === 'go_live_date') {
      if (idx.live_date === undefined) idx.live_date = c;
    }
    if (lower === 'cs_poc_email' || lower === 'cs poc email' || lower === 'csm email') idx.cs_poc_email = c;
  }
  return idx;
}
function enrichAlertsCsm_(alerts, lookup) {
  var book = loadWorkbookCsmLookup_();
  alerts.forEach(function (a) {
    var fromBook = resolveCsm_(a.rooftopId, a.rooftopName, '', book);
    var fromLive = resolveCsm_(a.rooftopId, a.rooftopName, '', lookup);
    a.csm = fromBook || fromLive || formatCsm_(a.csm) || '';
  });
}
function resolveCsm_(rooftopId, rooftopName, metabaseCsm, lookup) {
  if (cleanCsm_(metabaseCsm)) return formatCsm_(metabaseCsm);
  if (!lookup) return '';
  var id = String(rooftopId || '').trim();
  var normName = normalizeNameKey_(rooftopName);
  if (id && normName && lookup.byComposite[id + '|' + normName]) return lookup.byComposite[id + '|' + normName];
  if (id && lookup.byId[id]) return lookup.byId[id];
  if (normName && lookup.byName[normName]) return lookup.byName[normName];
  return '';
}
function normalizeNameKey_(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function getSheetByGidOrName_(ss, gid, name) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  return ss.getSheetByName(name);
}
function formatCsm_(csm) {
  return cleanCsm_(csm);
}
function cleanCsm_(csm) {
  var text = String(csm || '').trim();
  var lower = text.toLowerCase();
  if (!text || lower === 'unassigned' || lower === '#n/a' || lower === '#na' || lower === 'n/a' ||
      lower === 'na' || lower === '#ref!' || lower === 'none' || text === '—' || text === '-') return '';
  return text;
}
function formatCsmDisplay_(csm) {
  return formatCsm_(csm) || '';
}
function toNum_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  var n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function addDays_(iso, n) {
  var d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function yesterdayIst_() {
  return addDays_(Utilities.formatDate(new Date(), SHARED_TIMEZONE, 'yyyy-MM-dd'), -1);
}
function previousWorkingDay_(iso) {
  var cur = addDays_(iso, -1);
  while (!isWorkingDay_(cur)) cur = addDays_(cur, -1);
  return cur;
}

function csmSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return getSheetByGidOrName_(ss, CSM_TAB_GID, 'CSM');
}
function csmHeaderMap_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var scanRows = Math.min(sh.getLastRow(), 15);
  var values = sh.getRange(1, 1, scanRows, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    var map = {};
    for (var c = 0; c < values[r].length; c++) {
      var h = String(values[r][c] || '').trim().toLowerCase();
      if ((h === 'enterprise id' || h === 'enterprise_id') && map.enterprise_id === undefined) map.enterprise_id = c;
      if ((h === 'customer' || h === 'account' || h === 'rooftop_name' || h === 'rooftop name') && map.customer === undefined) map.customer = c;
      if (h === 'csm name') map.csm = c;
      else if (h === 'csm' && map.csm === undefined) map.csm = c;
      if (h === 'product' && map.product === undefined) map.product = c;
    }
    if (map.enterprise_id !== undefined && map.csm !== undefined) {
      return { row: r + 1, map: map };
    }
  }
  return null;
}
function setupCsmSheet() {
  var sh = csmSheet_();
  if (!sh) throw new Error('CSM tab not found (gid ' + CSM_TAB_GID + ').');
  var header = csmHeaderMap_(sh);
  if (!header) throw new Error('CSM tab needs columns Enterprise ID and CSM Name.');
  var note = 'CSM tab is readable. Header row ' + header.row +
    '. Alerts column I was not changed. The image matches enterprise_id to CSM Name.';
  Logger.log(note);
  SpreadsheetApp.getActive().toast('CSM tab is readable. Alerts column I was not changed.');
}
function loadWorkbookCsmLookup_() {
  var lookup = { byId: {}, byName: {}, byComposite: {} };
  paintAlertsCsm_(lookup);
  paintCsmSheet_(lookup);
  return lookup;
}
function paintAlertsCsm_(lookup) {
  var sh = setupSheets_().alerts;
  var last = sh.getLastRow();
  if (last < 2) return;
  var values = sh.getRange(2, 1, last - 1, 9).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var csm = formatCsm_(values[i][8]);
    if (!csm) continue;
    var id = String(values[i][3] || '').trim();
    var name = String(values[i][4] || '');
    var norm = normalizeNameKey_(name);
    var composite = id + '|' + norm;
    if (id && norm && !lookup.byComposite[composite]) lookup.byComposite[composite] = csm;
    if (id && !lookup.byId[id]) lookup.byId[id] = csm;
    if (norm && !lookup.byName[norm]) lookup.byName[norm] = csm;
  }
}
function paintCsmSheet_(lookup) {
  var sh = csmSheet_();
  if (!sh || sh.getLastRow() < 2) {
    Logger.log('CSM tab not found.');
    return;
  }
  var header = csmHeaderMap_(sh);
  if (!header) {
    Logger.log('CSM tab has no Enterprise ID and CSM Name headers.');
    return;
  }
  var last = sh.getLastRow();
  if (last <= header.row) return;
  var width = Math.max(sh.getLastColumn(), 1);
  var values = sh.getRange(header.row + 1, 1, last - header.row, width).getValues();
  var idCol = header.map.enterprise_id;
  var nameCol = header.map.customer;
  var csmCol = header.map.csm;
  var productCol = header.map.product;
  var ranked = { byId: {}, byName: {}, byComposite: {} };
  values.forEach(function (row) {
    var csm = formatCsm_(row[csmCol]);
    if (!csm) return;
    var id = String(row[idCol] || '').trim();
    if (!id || id.toLowerCase() === 'enterprise id') return;
    var norm = nameCol === undefined ? '' : normalizeNameKey_(row[nameCol]);
    var product = productCol === undefined ? '' : String(row[productCol] || '').trim().toLowerCase();
    var rank = product === 'vini' ? 2 : 1;
    rememberRanked_(ranked.byId, id, csm, rank);
    if (norm) rememberRanked_(ranked.byName, norm, csm, rank);
    if (id && norm) rememberRanked_(ranked.byComposite, id + '|' + norm, csm, rank);
  });
  ['byId', 'byName', 'byComposite'].forEach(function (bucket) {
    var flat = flattenRanked_(ranked[bucket]);
    Object.keys(flat).forEach(function (key) { lookup[bucket][key] = flat[key]; });
  });
}
function rememberRanked_(bucket, key, csm, rank) {
  if (!key || !csm) return;
  var prev = bucket[key];
  if (!prev || rank >= prev.rank) bucket[key] = { csm: csm, rank: rank };
}
function flattenRanked_(bucket) {
  var out = {};
  Object.keys(bucket).forEach(function (key) { out[key] = bucket[key].csm; });
  return out;
}
function fillBlankCsmOnAlerts_() {
  // Disabled. Running the script must not change Alerts column I.
  return 0;
}

var VINI_LOG_SHEET = 'Log';
var VINI_LOG_HEADERS = [
  'Timestamp (IST)', 'Run', 'As-of date', 'Daily rows upserted', 'Alerts appended', 'Status', 'Notes',
];
function setupViniLogSheet() {
  var sheet = getOrCreateViniLogSheet_();
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, VINI_LOG_HEADERS.length)
    .setFontWeight('bold').setBackground('#1f2933').setFontColor('#ffffff');
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(7, 420);
  SpreadsheetApp.getActive().toast('Log tab is ready.');
}
function logViniRun(entry) {
  entry = entry || {};
  var sheet = getOrCreateViniLogSheet_();
  var stamp = Utilities.formatDate(new Date(), SHARED_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    stamp,
    entry.run || '',
    entry.asOf || '',
    entry.dailyUpserted === 0 || entry.dailyUpserted ? entry.dailyUpserted : '',
    entry.alertsAppended === 0 || entry.alertsAppended ? entry.alertsAppended : '',
    entry.status || '',
    entry.notes || '',
  ]);
}
function getOrCreateViniLogSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(VINI_LOG_SHEET);
  if (!sheet) sheet = ss.insertSheet(VINI_LOG_SHEET);
  var header = sheet.getRange(1, 1, 1, VINI_LOG_HEADERS.length).getValues()[0];
  var blank = String(header[0] || '') === '';
  var wrong = VINI_LOG_HEADERS.some(function (name, index) { return header[index] !== name; });
  if (blank || (wrong && sheet.getLastRow() < 2)) {
    sheet.getRange(1, 1, 1, VINI_LOG_HEADERS.length).setValues([VINI_LOG_HEADERS]);
  }
  return sheet;
}
