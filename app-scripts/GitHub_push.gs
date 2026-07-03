// =============================================================================
// MyGridNZ — push Google Sheet data into the GitHub repo as static JSON
//
// Why: instead of every visitor hitting the live Google Sheets gviz endpoint
// (slow, rate-limited, CORS-fragile), a scheduled Apps Script fetches each
// sheet once and commits it to /data/*.json in the repo. The site then serves
// those static files from GitHub Pages — cleaner and much faster.
//
// SETUP (one-time):
//   1. Add GITHUB_TOKEN — either via Project Settings → Script properties, or
//      just paste it into setToken() below and Run that once (see notes there).
//      Use a fine-grained PAT with "Contents: read and write" on afcrossland/mygridnz.
//   2. Triggers → add a time-driven trigger running pushAllToGitHub() every 30 min.
//
// The site reads these files from https://nz.future-zero.com/data/*.json
// (see fetchSheet()/fetchTable() in the page scripts). The committed file is the
// RAW gviz response text, so the pages parse it exactly as before.
//
// Pushes use the GitHub Git Data API (blob → tree → commit → ref) rather than the
// Contents API, so files larger than 1 MB (the half-hourly window, 2030 timeseries)
// work too. A commit is only made when a file's git blob SHA actually changes.
// =============================================================================

// ── Config ──────────────────────────────────────────────────────────────────
const GITHUB_OWNER  = 'afcrossland';
const GITHUB_REPO   = 'mygridnz';
const GITHUB_BRANCH = 'main';

// Days of half-hourly history kept in the rolling "recent" window (last-28-days
// needs the latest full month; extra margin covers EMI publishing lag).
const RECENT_WINDOW_DAYS = 100;

// Each entry: { file, id, tab?, gid?, query? }.
//   tab   — named sheet tab (takes precedence over gid)
//   gid   — numeric tab id (default 0 when neither tab nor gid given)
//   query — gviz tq; may contain {{CUTOFF}}, replaced with (today − RECENT_WINDOW_DAYS)
const SHEETS = [
  // Monthly (last 3 years) + annual history — whole tabs.
  { file: 'data/monthly.json', id: '1plnHV6MLUJeHnyVJouxK4ve0akUt_Vbx8dkTuuMjHps' },
  { file: 'data/annual.json',  id: '1EN4wI5rzmdJgzSrynqSkoduw-uATYeVkkhuY_HvFVHs' },

  // Live snapshot — latest Transpower half-hour row.
  { file: 'data/live.json', id: '1-Z04BrlTd4kqvANGmMPsgPb3xlPiMRj5E4kVB35HidE',
    tab: 'TP data', query: "SELECT * WHERE B IS NOT NULL ORDER BY A DESC LIMIT 1" },

  // Rolling recent half-hourly window (last-28-days filters this client-side).
  { file: 'data/recent-halfhourly.json', id: '1-Z04BrlTd4kqvANGmMPsgPb3xlPiMRj5E4kVB35HidE',
    tab: 'data', query: "SELECT * WHERE B >= date '{{CUTOFF}}' ORDER BY A" },

  // Carbon tracker.
  { file: 'data/carbon-tracker-bar.json',   id: '1w2bX1YwhPYUOkxayfJtmNIG_SvCj8UDXxzTy5pxZEqM', gid: 0 },
  { file: 'data/carbon-tracker-lines.json', id: '1ItQ1pZ2JU0itdmcFveTqAtyg0mEyTAR5q54TatkS9D0', gid: 0 },

  // 2030 grid scenario (static — rarely changes; the unchanged guard skips no-op commits).
  { file: 'data/2030-mix.json',         id: '1-_pQ39Qd7lN0r9rQWHT8_ZLOiFbvGbttYnrbowVBtS0', gid: 0 },
  { file: 'data/2030-timeseries.json',  id: '1ODNW-bT018Adl-PRhPkpVjVFTp9qo_0sLOSHuqGxipk', gid: 0 },
  { file: 'data/2030-curtailment.json', id: '1bRqBHmH6lJQzhtewnFxauYWcLZ5hohSKDhELVC6mo2E', gid: 0 },
];

// ── One-off token setter ─────────────────────────────────────────────────────
// If the Script Properties editor won't save (a known Apps Script UI glitch),
// paste your token below, Run setToken once, then blank it out again.
function setToken() {
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', 'PASTE_TOKEN_HERE');
  const t = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  Logger.log('Saved GITHUB_TOKEN starting ' + (t ? t.slice(0, 8) : '(null)') + '…');
}

// ── Main: run on a 30-minute time trigger ────────────────────────────────────
function pushAllToGitHub() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Missing GITHUB_TOKEN script property');

  const cutoff = _cutoffDate(RECENT_WINDOW_DAYS);
  const shaMap = _existingShaMap(token, 'data');   // basename -> current git blob sha
  SHEETS.forEach(function (s) {
    try {
      const content = fetchSheetData(s, cutoff);
      const result  = pushToGitHub(token, s.file, content, shaMap);
      Logger.log(result + ': ' + s.file);
    } catch (e) {
      Logger.log('FAILED: ' + s.file + ' — ' + e.message);
    }
  });
}

// ── (today − days) as an Auckland-local yyyy-MM-dd string ────────────────────
function _cutoffDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return Utilities.formatDate(d, 'Pacific/Auckland', 'yyyy-MM-dd');
}

// ── Fetch one sheet/query as raw gviz JSON text ──────────────────────────────
function fetchSheetData(s, cutoff) {
  let url = 'https://docs.google.com/spreadsheets/d/' + s.id + '/gviz/tq?tqx=out:json';
  if (s.tab != null) url += '&sheet=' + encodeURIComponent(s.tab);
  else               url += '&gid=' + (s.gid != null ? s.gid : 0);
  if (s.query) url += '&tq=' + encodeURIComponent(s.query.replace('{{CUTOFF}}', cutoff));

  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('gviz HTTP ' + response.getResponseCode());
  }
  return response.getContentText();
}

// ── Map of basename → current git blob SHA for everything in a repo directory ─
// Directory listings work for files of any size (unlike GET contents on a file,
// which is capped at 1 MB), so this drives the unchanged-skip check.
function _existingShaMap(token, dir) {
  const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO +
              '/contents/' + dir + '?ref=' + GITHUB_BRANCH;
  const resp = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  const map = {};
  if (resp.getResponseCode() === 200) {
    JSON.parse(resp.getContentText()).forEach(function (f) { map[f.name] = f.sha; });
  }
  return map;   // empty on first run (directory not created yet)
}

// ── git blob SHA-1 of a string: sha1("blob " + <utf8 byte length> + NUL + bytes)
function _gitBlobSha(content) {
  const body  = Utilities.newBlob(content).getBytes();               // UTF-8 bytes
  const head  = Utilities.newBlob('blob ' + body.length).getBytes(); // "blob <N>"
  const bytes = head.concat([0]).concat(body);                       // + NUL byte + content
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, bytes);
  return digest.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// ── Push a file via the Git Data API (any size), skipping no-op commits ──────
function pushToGitHub(token, path, content, shaMap) {
  const api = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO;
  const headers = { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' };

  const call = function (method, endpoint, body) {
    const opts = { method: method, headers: headers, muteHttpExceptions: true };
    if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
    const r = UrlFetchApp.fetch(api + endpoint, opts);
    if (r.getResponseCode() >= 300) {
      throw new Error(method + ' ' + endpoint + ' → ' + r.getResponseCode() + ': ' + r.getContentText());
    }
    return JSON.parse(r.getContentText());
  };

  const base = path.split('/').pop();
  if (shaMap[base] && shaMap[base] === _gitBlobSha(content)) return 'unchanged';

  const parent  = call('get', '/git/ref/heads/' + GITHUB_BRANCH).object.sha;
  const baseTree = call('get', '/git/commits/' + parent).tree.sha;
  const blob    = call('post', '/git/blobs',
                    { content: Utilities.base64Encode(content, Utilities.Charset.UTF_8), encoding: 'base64' });
  const newTree = call('post', '/git/trees',
                    { base_tree: baseTree, tree: [{ path: path, mode: '100644', type: 'blob', sha: blob.sha }] });
  const commit  = call('post', '/git/commits',
                    { message: 'data: auto-update ' + path, tree: newTree.sha, parents: [parent] });
  call('patch', '/git/refs/heads/' + GITHUB_BRANCH, { sha: commit.sha });
  return 'updated';
}
