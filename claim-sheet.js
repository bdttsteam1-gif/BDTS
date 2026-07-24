// claim-sheet.js — 클레임 엑셀 업로드 "전 직원 공유" 모듈
// ------------------------------------------------------------------
// 클레임 현황에서 엑셀을 업로드하면 신규 건이 구글 스프레드시트의
// 'claim_extra' 탭에 "한 건당 한 행"으로 저장되어 모든 직원의 화면
// (어떤 기기/브라우저든)에 자동으로 반영됩니다.
//
// - 거래처이력/CSC와 같은 Apps Script 웹앱 URL을 사용합니다.
// - 대용량 JSON을 통째로 하나의 셀에 밀어넣던 이전 방식(chunk blob) 대신,
//   거래처이력과 동일하게 "행 단위 저장"으로 바꿔 대량 업로드(수천 건)도
//   URL 길이 제한 없이 안정적으로 처리합니다.
// - 공유 저장소를 읽거나 쓰지 못하면 이 브라우저(localStorage) 데이터로 폴백합니다.
// ------------------------------------------------------------------

var CLAIM_SHEET_API_URL = (typeof HUB_SHEET_API_URL !== 'undefined' && HUB_SHEET_API_URL) ||
  'https://script.google.com/macros/s/AKfycbxkxRmbkTjnzFciIk6p_I9-8rbVzYZVcs7xO2MPEBkp0X4uOUAf8QmXgebpS7FpYkWxFA/exec';
var CLAIM_SHEET_TOKEN = (typeof HUB_SHEET_TOKEN !== 'undefined' && HUB_SHEET_TOKEN) || '0p9o8i7u';
var CLAIM_SHEET_NAME = 'claim_extra';
var CLAIM_BATCH_CHARS = 3500; // 한 번의 GET(JSONP) 요청 URL에 담을 레코드 묶음의 최대 크기(퍼센트 인코딩 후 문자 수 기준, URL 길이 안전 마진)

var _claimExtrasCache = null; // { '2024':[...], '2025':[...], '2026':[...] }
var _claimRowIds = {};        // { '2024': ['id1','id2', ...] } — reset(삭제)용
var _claimSharedOk = false;   // 마지막 로드가 공유 저장소에서 성공했는지

// ---- localStorage 폴백/캐시 ----
function _localExtrasGet(year) {
  try { return JSON.parse(localStorage.getItem('claim_extra_' + year) || '[]'); }
  catch (e) { return []; }
}
function _localExtrasSet(year, arr) {
  try { localStorage.setItem('claim_extra_' + year, JSON.stringify(arr)); } catch (e) {}
}

function isClaimSheetConfigured() {
  return !!CLAIM_SHEET_API_URL;
}

// ---- Apps Script JSONP 호출 (URL 길이 제한 안에서만 안전하게 사용) ----
var _csCounter = 0;
function _claimJsonp(params, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  return new Promise(function (resolve, reject) {
    var cb = 'csjsonp_' + Date.now() + '_' + (_csCounter++);
    var script = document.createElement('script');
    var done = false, timer;
    function cleanup() { delete window[cb]; if (script.parentNode) script.parentNode.removeChild(script); clearTimeout(timer); }
    window[cb] = function (data) { if (done) return; done = true; cleanup(); resolve(data); };
    timer = setTimeout(function () { if (done) return; done = true; cleanup(); reject(new Error('요청 시간이 초과되었습니다.')); }, timeoutMs);
    script.onerror = function () { if (done) return; done = true; cleanup(); reject(new Error('요청을 보내지 못했습니다.')); };
    var qs = new URLSearchParams(Object.assign({}, params, { callback: cb, token: CLAIM_SHEET_TOKEN })).toString();
    script.src = CLAIM_SHEET_API_URL + '?' + qs;
    document.body.appendChild(script);
  });
}

// 모든 연도의 "업로드 추가분"을 가져옴 (공유 저장소 우선, 실패 시 이 브라우저 데이터)
async function fetchAllClaimExtras() {
  if (_claimExtrasCache) return _claimExtrasCache;
  var years = ['2024', '2025', '2026'];
  var out = {};
  if (isClaimSheetConfigured()) {
    try {
      var rows = await _claimJsonp({ sheet: CLAIM_SHEET_NAME, action: 'list' }, 60000);
      if (rows && rows.error) throw new Error(rows.error);
      if (!Array.isArray(rows)) rows = [];
      years.forEach(function (y) { out[y] = []; });
      _claimRowIds = {};
      rows.forEach(function (r) {
        var y = String(r.year || '');
        if (!out[y]) out[y] = [];
        if (!_claimRowIds[y]) _claimRowIds[y] = [];
        var rec = Object.assign({}, r);
        delete rec.id; delete rec.year; // 내부 관리 필드는 화면 로직에 노출하지 않음
        out[y].push(rec);
        _claimRowIds[y].push(r.id);
      });
      years.forEach(function (y) { _localExtrasSet(y, out[y]); }); // 오프라인 대비 캐시
      _claimSharedOk = true;
      _claimExtrasCache = out;
      return out;
    } catch (e) {
      console.warn('클레임 공유 데이터 불러오기 실패, 이 브라우저의 로컬 데이터로 대체합니다:', e);
    }
  }
  years.forEach(function (y) { out[y] = _localExtrasGet(y); });
  _claimSharedOk = false;
  _claimExtrasCache = out;
  return out;
}

function invalidateClaimExtrasCache() { _claimExtrasCache = null; }

// 배열을 대략적인 "URL 인코딩 후" 문자 수 단위로 묶음(batch)으로 나눈다.
// 한글 등 멀티바이트 문자는 percent-encoding 시 훨씬 길어지므로 encodeURIComponent 기준으로 계산한다.
// 한 레코드가 한도보다 크더라도 최소 1건은 포함시켜 무한루프를 방지한다.
function _chunkByChars(items, maxChars) {
  var batches = [], cur = [], curLen = 2; // "[]"
  items.forEach(function (it) {
    var len = encodeURIComponent(JSON.stringify(it)).length + 3;
    if (cur.length && curLen + len > maxChars) { batches.push(cur); cur = []; curLen = 2; }
    cur.push(it); curLen += len;
  });
  if (cur.length) batches.push(cur);
  return batches;
}

// 한 묶음을 저장 시도. 실패하면 한 번 재시도 → 그래도 실패하면 반으로 쪼개 재귀 시도.
// (건 1개짜리까지 쪼개도 실패하면 그 건만 로컬 실패로 처리 — 업로드 전체가 로컬로 떨어지는 것을 방지)
async function _sendBatchResilient(rows, onOneDone) {
  try {
    var res = await _claimJsonp({ sheet: CLAIM_SHEET_NAME, action: 'bulkAdd', records: JSON.stringify(rows) }, 30000);
    if (res && res.error) throw new Error(res.error);
    if (onOneDone) onOneDone(rows.length);
    return { ok: rows, fail: [] };
  } catch (e1) {
    try {
      var res2 = await _claimJsonp({ sheet: CLAIM_SHEET_NAME, action: 'bulkAdd', records: JSON.stringify(rows) }, 30000);
      if (res2 && res2.error) throw new Error(res2.error);
      if (onOneDone) onOneDone(rows.length);
      return { ok: rows, fail: [] };
    } catch (e2) {
      if (rows.length <= 1) {
        if (onOneDone) onOneDone(1);
        return { ok: [], fail: rows, lastError: e2 };
      }
      var mid = Math.ceil(rows.length / 2);
      var r1 = await _sendBatchResilient(rows.slice(0, mid), onOneDone);
      var r2 = await _sendBatchResilient(rows.slice(mid), onOneDone);
      return { ok: r1.ok.concat(r2.ok), fail: r1.fail.concat(r2.fail), lastError: r2.lastError || r1.lastError };
    }
  }
}

// 신규 클레임 레코드들을 저장 — 행 단위로 'claim_extra' 시트에 bulkAdd
async function postClaimExtras(year, records, onProgress) {
  var current = [];
  if (_claimExtrasCache && _claimExtrasCache[year]) current = _claimExtrasCache[year];
  else current = _localExtrasGet(year);

  var seen = {};
  current.forEach(function (r) { if (r && r.no) seen[r.no] = 1; });
  var freshRecs = records.filter(function (r) { return r && r.no && !seen[r.no]; });
  var merged = current.concat(freshRecs);

  if (isClaimSheetConfigured() && freshRecs.length) {
    var rows = freshRecs.map(function (r) {
      return Object.assign({ id: 'CE_' + year + '_' + r.no, year: year }, r);
    });
    var batches = _chunkByChars(rows, CLAIM_BATCH_CHARS);
    var okRows = [], failRows = [], lastError = null, done = 0;
    var total = rows.length;
    for (var i = 0; i < batches.length; i++) {
      var r = await _sendBatchResilient(batches[i], function (n) { done += n; if (onProgress) onProgress(done, total); });
      okRows = okRows.concat(r.ok);
      failRows = failRows.concat(r.fail);
      if (r.lastError) lastError = r.lastError;
    }
    okRows.forEach(function (r) {
      if (!_claimRowIds[year]) _claimRowIds[year] = [];
      _claimRowIds[year].push(r.id);
    });
    _localExtrasSet(year, merged);
    if (_claimExtrasCache) _claimExtrasCache[year] = merged;
    if (failRows.length === 0) {
      return { success: true, added: freshRecs.length, mode: 'shared' };
    }
    console.warn('일부 클레임 공유 저장 실패(' + failRows.length + '/' + total + '건), 해당 건은 이 브라우저에만 저장됩니다:', lastError);
    return {
      success: true, added: freshRecs.length,
      mode: okRows.length > 0 ? 'partial' : 'local',
      sharedCount: okRows.length, localCount: failRows.length,
      error: String(lastError && lastError.message || lastError)
    };
  }
  _localExtrasSet(year, merged);
  if (_claimExtrasCache) _claimExtrasCache[year] = merged;
  return { success: true, added: freshRecs.length, mode: 'local' };
}

// 특정 연도의 업로드 추가분 전체 삭제 (공유 저장소의 해당 연도 행도 모두 삭제)
async function resetClaimExtras(year) {
  if (isClaimSheetConfigured() && _claimSharedOk) {
    var ids = _claimRowIds[year] || [];
    try {
      for (var i = 0; i < ids.length; i++) {
        await _claimJsonp({ sheet: CLAIM_SHEET_NAME, action: 'delete', id: ids[i] }, 20000);
      }
      _claimRowIds[year] = [];
      localStorage.removeItem('claim_extra_' + year);
      if (_claimExtrasCache) _claimExtrasCache[year] = [];
      return { success: true, mode: 'shared' };
    } catch (e) {
      console.warn('공유 저장소 초기화 실패(일부만 삭제되었을 수 있음):', e);
    }
  }
  localStorage.removeItem('claim_extra_' + year);
  if (_claimExtrasCache) _claimExtrasCache[year] = [];
  return { success: true, mode: 'local' };
}
