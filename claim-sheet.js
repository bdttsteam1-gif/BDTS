// claim-sheet.js — 클레임 엑셀 업로드 "전 직원 공유" 모듈 (Azure 판)
// ------------------------------------------------------------------
// 깃허브(BDTS-main)의 claim-sheet.js 를 그대로 대체합니다.
// ★ 함수 이름과 호출 방법이 예전과 완전히 같습니다. 화면 코드(claim.html /
//   search.html)는 한 글자도 고칠 필요가 없습니다.
//
//     isClaimSheetConfigured()
//     fetchAllClaimExtras()            → { '2024':[...], '2025':[...], ... }
//     invalidateClaimExtrasCache()
//     postClaimExtras(year, records, onProgress)
//     resetClaimExtras(year)
//
// 달라진 점 (내부 동작만):
//   - 구글 Apps Script JSONP → Azure Table('claim_extra' 파티션)
//   - URL 길이 제한이 없어졌으므로 3,500자 단위 배치 쪼개기가 사라졌습니다.
//   - 토큰을 코드에 심지 않습니다. 인증은 Azure 로그인 쿠키가 처리합니다.
//
// ★ 포털의 "클레임 현황"(pages/claim.html)은 업로드분을 Blob 저장소('claims')에
//   담습니다. 통합검색에서 그 건들도 함께 보이도록, 아래 fetchAllClaimExtras()는
//   claim_extra 테이블과 claims Blob 을 둘 다 읽어 합칩니다. 중복은
//   "관리번호 + 접수일 + 제목" 으로 판정합니다(관리번호만으로 판정하면 같은
//   번호를 쓰는 서로 다른 클레임 124건이 사라집니다).
// ------------------------------------------------------------------

var CLAIM_SHEET_NAME = 'claim_extra';

var _claimExtrasCache = null; // { '2024':[...], ... }
var _claimRowIds = {};        // { '2024': ['CE_2024_...', ...] } — reset(삭제)용
var _claimSharedOk = false;

var _claimStore = null;
function _cs() {
  if (!_claimStore) _claimStore = makeHubStore(CLAIM_SHEET_NAME, 'claim_extra_v1');
  return _claimStore;
}
var _claimBlob = null;
function _cb() {
  if (!_claimBlob) _claimBlob = makeBlobStore('claims');
  return _claimBlob;
}

// ---- localStorage 폴백/캐시 (서버를 못 읽을 때만 사용) ----
function _localExtrasGet(year) {
  try { return JSON.parse(localStorage.getItem('claim_extra_' + year) || '[]'); }
  catch (e) { return []; }
}
function _localExtrasSet(year, arr) {
  try { localStorage.setItem('claim_extra_' + year, JSON.stringify(arr)); } catch (e) {}
}

function isClaimSheetConfigured() {
  return typeof makeHubStore === 'function';
}

function _rowKey(r) {
  return [r && r.no, r && r.recv_date, r && r.title]
    .map(function (v) { return String(v == null ? '' : v).trim(); }).join('|');
}

// 포털 클레임 현황이 Blob 에 쌓아둔 업로드분을 연도별로 읽어옵니다.
// 형식: { '2024': { ver, data:[...] }, ... }  (없으면 조용히 빈 값)
function _fetchBlobExtras() {
  try {
    return _cb().loadAll().then(function (all) {
      var out = {};
      Object.keys(all || {}).forEach(function (k) {
        var v = all[k];
        var arr = (v && v.data) ? v.data : v;
        if (Array.isArray(arr)) out[String(k)] = arr;
      });
      return out;
    }).catch(function () { return {}; });
  } catch (e) {
    return Promise.resolve({});
  }
}

async function fetchAllClaimExtras() {
  if (_claimExtrasCache) return _claimExtrasCache;
  var years = (typeof CLAIM_YEARS !== 'undefined' && CLAIM_YEARS.length)
    ? CLAIM_YEARS.slice() : ['2024', '2025', '2026'];
  var out = {};

  if (isClaimSheetConfigured()) {
    try {
      var pair = await Promise.all([_cs().list(), _fetchBlobExtras()]);
      var rows = Array.isArray(pair[0]) ? pair[0] : [];
      var blobs = pair[1] || {};

      years.forEach(function (y) { out[y] = []; });
      _claimRowIds = {};

      var seen = {};
      rows.forEach(function (r) {
        var y = String(r.year || '');
        if (!out[y]) out[y] = [];
        if (!_claimRowIds[y]) _claimRowIds[y] = [];
        var rec = Object.assign({}, r);
        delete rec.id; delete rec.year; // 내부 관리 필드는 화면 로직에 노출하지 않음
        out[y].push(rec);
        seen[_rowKey(rec)] = 1;
        _claimRowIds[y].push(r.id);
      });

      // 포털 "클레임 현황"에서 올린 업로드분 합치기 (중복은 건너뜀)
      Object.keys(blobs).forEach(function (y) {
        if (!out[y]) out[y] = [];
        blobs[y].forEach(function (rec) {
          if (!rec || seen[_rowKey(rec)]) return;
          seen[_rowKey(rec)] = 1;
          out[y].push(rec);
        });
      });

      years.forEach(function (y) { _localExtrasSet(y, out[y] || []); }); // 오프라인 대비 캐시
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

// 신규 건만 골라 저장합니다. 기존 건은 지우지 않습니다.
// 중복 판정은 화면(claim.html)과 동일하게 관리번호+접수일+제목으로 합니다.
async function postClaimExtras(year, records, onProgress) {
  year = String(year);
  var current = (_claimExtrasCache && _claimExtrasCache[year]) || _localExtrasGet(year);

  var seen = {};
  current.forEach(function (r) { seen[_rowKey(r)] = 1; });
  var freshRecs = (records || []).filter(function (r) {
    if (!r || !r.no) return false;
    var k = _rowKey(r);
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });
  var merged = current.concat(freshRecs);

  if (isClaimSheetConfigured() && freshRecs.length) {
    var okRows = [], failRows = [], lastError = null, done = 0;
    var total = freshRecs.length;

    for (var i = 0; i < freshRecs.length; i++) {
      var r = freshRecs[i];
      // id 는 관리번호만으로 만들면 같은 번호를 쓰는 다른 건이 서로를 덮어씁니다.
      // 접수일·제목까지 섞은 짧은 해시를 붙여 고유하게 만듭니다.
      var row = Object.assign({ id: 'CE_' + year + '_' + r.no + '_' + _shortHash(_rowKey(r)), year: year }, r);
      try {
        await _cs().add(row);
        okRows.push(row);
        if (!_claimRowIds[year]) _claimRowIds[year] = [];
        _claimRowIds[year].push(row.id);
      } catch (e) {
        failRows.push(row);
        lastError = e;
      }
      done++;
      if (onProgress) onProgress(done, total);
    }

    _localExtrasSet(year, merged);
    if (_claimExtrasCache) _claimExtrasCache[year] = merged;

    if (failRows.length === 0) {
      return { success: true, added: freshRecs.length, mode: 'shared' };
    }
    console.warn('일부 클레임 공유 저장 실패(' + failRows.length + '/' + total + '건):', lastError);
    return {
      success: true, added: freshRecs.length,
      mode: okRows.length > 0 ? 'partial' : 'local',
      sharedCount: okRows.length, localCount: failRows.length,
      error: lastError ? lastError.message : ''
    };
  }

  _localExtrasSet(year, merged);
  if (_claimExtrasCache) _claimExtrasCache[year] = merged;
  return { success: true, added: freshRecs.length, mode: 'local' };
}

async function resetClaimExtras(year) {
  year = String(year);
  if (isClaimSheetConfigured() && _claimSharedOk) {
    var ids = _claimRowIds[year] || [];
    try {
      for (var i = 0; i < ids.length; i++) await _cs().remove(ids[i], null, { hard: true });
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

// 짧은 해시 — 파일 이름/키에 쓸 수 있는 8자리 16진수
function _shortHash(s) {
  var h = 5381;
  s = String(s);
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return ('0000000' + h.toString(16)).slice(-8);
}
