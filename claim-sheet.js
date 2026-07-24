// claim-sheet.js — 클레임 엑셀 업로드 "전 직원 공유" 모듈 (data-sync.js 기반)
// ------------------------------------------------------------------
// 클레임 현황에서 엑셀을 업로드하면 신규 건이 구글 스프레드시트의
// 'upload_blobs' 탭(키: claim_extra_연도)에 저장되어 모든 직원의
// 화면(어떤 기기/브라우저든)에 자동으로 반영됩니다.
//
// - 거래처이력/CSC와 같은 Apps Script 웹앱(hub / data-sync URL)을 사용합니다.
// - 공유 저장소를 읽지 못하면 이 브라우저(localStorage) 데이터로 폴백합니다.
// - 반드시 data-sync.js 를 먼저 로드해야 합니다.
// ------------------------------------------------------------------

var _claimBlobStore = (typeof makeBlobStore === 'function') ? makeBlobStore('upload_blobs') : null;
var _claimExtrasCache = null; // { '2024':[...], '2025':[...], '2026':[...] }
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
  return !!(_claimBlobStore && _claimBlobStore.shared);
}

// 모든 연도의 "업로드 추가분"을 가져옴 (공유 저장소 우선, 실패 시 이 브라우저 데이터)
async function fetchAllClaimExtras() {
  if (_claimExtrasCache) return _claimExtrasCache;
  var years = ['2024', '2025', '2026'];
  var out = {};
  if (isClaimSheetConfigured()) {
    try {
      var blobs = await _claimBlobStore.loadAll();
      years.forEach(function (y) {
        var b = blobs['claim_extra_' + y];
        out[y] = (b && Array.isArray(b.data)) ? b.data : [];
        _localExtrasSet(y, out[y]); // 오프라인 대비 캐시
      });
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

// 신규 클레임 레코드들을 저장 — 기존 공유분 + 신규를 합쳐 해당 연도 blob을 통째로 갱신
async function postClaimExtras(year, records, onProgress) {
  var current = [];
  if (_claimExtrasCache && _claimExtrasCache[year]) current = _claimExtrasCache[year];
  else current = _localExtrasGet(year);

  var seen = {};
  current.forEach(function (r) { if (r && r.no) seen[r.no] = 1; });
  var merged = current.concat(records.filter(function (r) { return r && r.no && !seen[r.no]; }));

  if (isClaimSheetConfigured()) {
    try {
      await _claimBlobStore.save('claim_extra_' + year, merged, onProgress);
      _localExtrasSet(year, merged);
      if (_claimExtrasCache) _claimExtrasCache[year] = merged;
      return { success: true, added: records.length, mode: 'shared' };
    } catch (e) {
      console.warn('공유 저장 실패, 이 브라우저에만 저장합니다:', e);
    }
  }
  _localExtrasSet(year, merged);
  if (_claimExtrasCache) _claimExtrasCache[year] = merged;
  return { success: true, added: records.length, mode: 'local' };
}

// 특정 연도의 업로드 추가분 전체 삭제 (공유 저장소에도 빈 목록으로 반영)
async function resetClaimExtras(year) {
  if (isClaimSheetConfigured() && _claimSharedOk) {
    try {
      await _claimBlobStore.save('claim_extra_' + year, []);
      localStorage.removeItem('claim_extra_' + year);
      if (_claimExtrasCache) _claimExtrasCache[year] = [];
      return { success: true, mode: 'shared' };
    } catch (e) {
      console.warn('공유 저장소 초기화 실패:', e);
    }
  }
  localStorage.removeItem('claim_extra_' + year);
  if (_claimExtrasCache) _claimExtrasCache[year] = [];
  return { success: true, mode: 'local' };
}
