// =============================================================================
// NZ Generation Data Importer — Google Apps Script
// Electricity Authority EMI: Generation_MD monthly CSVs
//
// ENTRY POINTS:
//   importLast5Years()  — one-time historical backfill (resumable if it times out)
//   resumeBackfill()    — continue a timed-out backfill from where it left off
//   importLastMonth()   — append last month's data (run monthly via a time trigger)
// =============================================================================

// ---------------------------------------------------------------------------
// CONFIGURATION — edit these variables before running
// ---------------------------------------------------------------------------

const OUTPUT_SHEET_NAME = 'data';         // Name of the sheet to write data into
const SPREADSHEET_ID    = '1-Z04BrlTd4kqvANGmMPsgPb3xlPiMRj5E4kVB35HidE';

// Fuel codes as they appear in the EMI CSV → friendly column name in the sheet.
// Any Fuel_Code not listed here is summed into the "Other" column.
const FUEL_MAP = {
  'Hydro':  'Hydro',
  'Geo':    'Geothermal',
  'Gas':    'Gas',
  'Wind':   'Wind',
  'Solar':  'Solar',
  'Wood':   'Wood',
  'Coal':   'Coal',
  'Diesel': 'Diesel',
};

// Number of years of history to pull in the backfill
const BACKFILL_YEARS = 5;

// Milliseconds to pause between CSV downloads (be kind to the server)
const REQUEST_DELAY_MS = 500;

// Stop processing and save progress if fewer than this many seconds remain
// in the Apps Script execution window (6-minute hard limit)
const EXECUTION_BUFFER_S = 45;

// ---------------------------------------------------------------------------
// INTERNAL CONSTANTS — do not edit
// ---------------------------------------------------------------------------

const BASE_URL      = 'https://emidatasets.blob.core.windows.net/publicdata/Datasets/Wholesale/Generation/Generation_MD/';
const FUEL_KEYS     = Object.keys(FUEL_MAP);
const FUEL_NAMES    = Object.values(FUEL_MAP);
const HEADERS       = ['DateTime', 'Date', 'Trading_Period', ...FUEL_NAMES, 'Other', 'Total'];
const PROP_PROGRESS = 'BACKFILL_PROGRESS'; // key in PropertiesService

// =============================================================================
// DIAGNOSTIC
// =============================================================================

/**
 * Run this once to see every unique Fuel_Code in a recent month's CSV.
 * Check the Apps Script log after running — then update FUEL_MAP above to match.
 */
function diagnoseFuelCodes() {
  const year = 2021, month = 6; // change if needed
  const url  = `${BASE_URL}${_yyyymm(year, month)}_Generation_MD.csv`;
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) { Logger.log('Could not fetch file'); return; }

  const parsed    = _parseCsv(resp.getContentText());
  const headerLow = parsed[0].map(h => h.trim().toLowerCase());
  const colFuel   = headerLow.indexOf('fuel_code');
  if (colFuel === -1) { Logger.log('fuel_code column not found. Header: ' + parsed[0].join(', ')); return; }

  const codes = new Set();
  for (let r = 1; r < parsed.length; r++) codes.add(parsed[r][colFuel]?.trim());
  Logger.log('Unique Fuel_Code values found:\n' + [...codes].sort().join('\n'));
}

// =============================================================================
// ENTRY POINTS
// =============================================================================

/**
 * One-time historical backfill — pulls the last BACKFILL_YEARS of data.
 * Clears the sheet first, then writes oldest month first.
 * If the script times out, run resumeBackfill() to continue.
 */
function importLast5Years() {
  const months = _buildMonthList(BACKFILL_YEARS);

  // Clear sheet and write header
  const sheet = _getOrCreateSheet();
  sheet.clearContents();
  sheet.appendRow(HEADERS);
  _freezeHeader(sheet);

  // Save the full list of months so resumeBackfill() can continue
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_PROGRESS, JSON.stringify(months));

  Logger.log(`Starting backfill: ${months.length} months from ${months[0].label} to ${months[months.length-1].label}`);
  _processMonthQueue(sheet, false);
}

/**
 * Continue a backfill that was interrupted by the 6-minute execution limit.
 * Run this repeatedly until the log shows "Backfill complete."
 */
function resumeBackfill() {
  const props = PropertiesService.getScriptProperties();
  const raw   = props.getProperty(PROP_PROGRESS);
  if (!raw) {
    Logger.log('No backfill in progress. Run importLast5Years() first.');
    return;
  }
  const sheet = _getOrCreateSheet();
  Logger.log('Resuming backfill...');
  _processMonthQueue(sheet, false);
}

/**
 * Append last month's data. Safe to run if data already exists — it checks the
 * last date in the sheet and only adds rows newer than that.
 * Wire this up to a monthly time-based trigger.
 */
function importLastMonth() {
  const now    = new Date();
  const d      = new Date(now.getFullYear(), now.getMonth() - 1, 1); // first day of last month
  const year   = d.getFullYear();
  const month  = d.getMonth() + 1;
  const label  = _yyyymm(year, month);

  Logger.log(`Running monthly update for ${label}`);
  const sheet  = _getOrCreateSheet();

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    _freezeHeader(sheet);
  }

  // Check whether this month is already present
  if (_monthAlreadyLoaded(sheet, year, month)) {
    Logger.log(`${label} is already in the sheet — skipping.`);
    return;
  }

  const rows = _fetchAndProcess(year, month);
  if (rows.length > 0) {
    _batchWrite(sheet, rows);
    Logger.log(`${label}: wrote ${rows.length} rows.`);
  } else {
    Logger.log(`${label}: no data returned (file may not be published yet).`);
  }
}

// =============================================================================
// CORE PROCESSING
// =============================================================================

/**
 * Work through the remaining months stored in PropertiesService.
 * Stops before the execution time limit and saves remaining work.
 */
function _processMonthQueue(sheet, deduplicate) {
  const props     = PropertiesService.getScriptProperties();
  const startTime = Date.now();
  let remaining   = JSON.parse(props.getProperty(PROP_PROGRESS) || '[]');

  while (remaining.length > 0) {
    // Check execution time — stop with a buffer before the hard 6-min limit
    const elapsedS = (Date.now() - startTime) / 1000;
    if (elapsedS > (360 - EXECUTION_BUFFER_S)) {
      props.setProperty(PROP_PROGRESS, JSON.stringify(remaining));
      Logger.log(`Execution limit approaching — pausing. ${remaining.length} months left. Run resumeBackfill() to continue.`);
      return;
    }

    const { year, month, label } = remaining.shift();
    Logger.log(`Processing ${label}...`);

    try {
      if (deduplicate && _monthAlreadyLoaded(sheet, year, month)) {
        Logger.log(`  ${label} already present — skipping.`);
      } else {
        const rows = _fetchAndProcess(year, month);
        if (rows.length > 0) {
          _batchWrite(sheet, rows);
          Logger.log(`  ${label}: ${rows.length} rows written.`);
        } else {
          Logger.log(`  ${label}: no data (file may not exist yet).`);
        }
      }
    } catch (e) {
      Logger.log(`  ${label}: ERROR — ${e.message}`);
    }

    Utilities.sleep(REQUEST_DELAY_MS);
  }

  // All done — clear the saved state
  props.deleteProperty(PROP_PROGRESS);
  Logger.log('Backfill complete.');
}

/**
 * Download and process one month's CSV.
 * Returns an array of row-arrays ready to write to the sheet.
 * Data is in ascending order (oldest trading period first).
 */
function _fetchAndProcess(year, month) {
  const label = _yyyymm(year, month);
  const url   = `${BASE_URL}${label}_Generation_MD.csv`;

  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log(`  HTTP ${response.getResponseCode()} for ${url}`);
    return [];
  }

  const csv    = response.getContentText();
  const parsed = _parseCsv(csv);
  if (parsed.length < 2) return [];

  const header     = parsed[0].map(h => h.trim());
  const headerLow  = header.map(h => h.toLowerCase());
  const colDate    = headerLow.indexOf('trading_date');
  const colFuel    = headerLow.indexOf('fuel_code');

  if (colDate === -1 || colFuel === -1) {
    throw new Error(`Unexpected CSV header: ${header.join(', ')}`);
  }

  // Find TP column indices (TP1–TP50; 46 periods on DST start, 50 on DST end)
  const tpIndices = [];
  for (let tp = 1; tp <= 50; tp++) {
    tpIndices.push(headerLow.indexOf(`tp${tp}`));
  }

  // ── Aggregate: { "YYYY-MM-DD|TP": { fuelCode: totalKwh } } ──
  const agg = {};

  for (let r = 1; r < parsed.length; r++) {
    const row  = parsed[r];
    const date = _normaliseDate(row[colDate]?.trim());
    const fuel = row[colFuel]?.trim();
    if (!date || !fuel) continue;

    for (let tp = 0; tp < tpIndices.length; tp++) {
      const colIdx = tpIndices[tp];
      if (colIdx === -1 || colIdx >= row.length) continue;
      const raw = row[colIdx]?.trim();
      if (!raw) continue;
      const kwh = parseFloat(raw);
      if (isNaN(kwh) || kwh <= 0) continue;

      const key = `${date}|${tp + 1}`;
      if (!agg[key]) agg[key] = {};
      agg[key][fuel] = (agg[key][fuel] || 0) + kwh;
    }
  }

  // ── Convert aggregated data to sheet rows ──
  // Sort by date then trading period (ascending = oldest first)
  const keys = Object.keys(agg).sort((a, b) => {
    const [da, tpa] = a.split('|');
    const [db, tpb] = b.split('|');
    return da < db ? -1 : da > db ? 1 : parseInt(tpa) - parseInt(tpb);
  });

  return keys.map(key => {
    const [date, tpStr] = key.split('|');
    const tp            = parseInt(tpStr, 10);
    const fuels         = agg[key];

    // kWh (per 30-min period) → MW
    // MW = kWh / 0.5 h / 1000 = kWh / 500
    const fuelMW = FUEL_KEYS.map(fc => _round(( fuels[fc] || 0) / 500, 3));

    const knownSet = new Set(FUEL_KEYS);
    const otherKwh = Object.entries(fuels)
      .filter(([fc]) => !knownSet.has(fc))
      .reduce((s, [, v]) => s + v, 0);
    const otherMW = _round(otherKwh / 500, 3);

    const total = _round(fuelMW.reduce((s, v) => s + v, 0) + otherMW, 3);

    // Build DateTime string: TP1 = 00:00, TP2 = 00:30, …
    const minutes  = (tp - 1) * 30;
    const hh       = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm       = String(minutes % 60).padStart(2, '0');
    const dateTime = `${date} ${hh}:${mm}`;

    return [dateTime, date, tp, ...fuelMW, otherMW, total];
  });
}

// =============================================================================
// SHEET HELPERS
// =============================================================================

function _getOrCreateSheet() {
  const ss    = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OUTPUT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(OUTPUT_SHEET_NAME);
    Logger.log(`Created sheet "${OUTPUT_SHEET_NAME}"`);
  }
  return sheet;
}

function _freezeHeader(sheet) {
  sheet.setFrozenRows(1);
  // Bold the header row
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
}

/** Batch-write rows to the next available rows in the sheet */
function _batchWrite(sheet, rows) {
  if (rows.length === 0) return;
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, HEADERS.length).setValues(rows);
}

/** Check whether any row in the sheet has a date in YYYY-MM matching year/month */
function _monthAlreadyLoaded(sheet, year, month) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  const prefix  = `${year}-${String(month).padStart(2, '0')}`;
  // Read the Date column (col B = index 2)
  const dates   = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  return dates.some(([d]) => String(d).startsWith(prefix));
}

// =============================================================================
// DATE / STRING UTILITIES
// =============================================================================

/** Normalise various date formats to YYYY-MM-DD */
function _normaliseDate(raw) {
  if (!raw) return null;
  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // DD/MM/YYYY
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // MM/DD/YYYY (less common but guard against it)
  const m2 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m2) return `${m2[3].length === 2 ? '20'+m2[3] : m2[3]}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
  return null;
}

function _yyyymm(year, month) {
  return `${year}${String(month).padStart(2, '0')}`;
}

function _round(val, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Build a list of { year, month, label } objects from BACKFILL_YEARS years ago
 * up to (and including) last month, in ascending chronological order.
 */
function _buildMonthList(years) {
  const now    = new Date();
  const months = [];
  // Start from (years) years ago, end at last completed month
  for (let i = years * 12 - 1; i >= 0; i--) {
    const d     = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
    const year  = d.getFullYear();
    const month = d.getMonth() + 1;
    months.push({ year, month, label: _yyyymm(year, month) });
  }
  return months;
}

// =============================================================================
// CSV PARSER — handles quoted fields and embedded commas
// =============================================================================

function _parseCsv(text) {
  const rows  = [];
  // Normalise line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) continue;
    rows.push(_parseCsvLine(trimmed));
  }
  return rows;
}

function _parseCsvLine(line) {
  const fields  = [];
  let field     = '';
  let inQuotes  = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if      (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(field); field = ''; }
      else                 { field += ch; }
    }
  }
  fields.push(field);
  return fields;
}
