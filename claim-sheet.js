// claim-sheet.js — 클레임 엑셀 업로드를 "전 직원 공유"로 만드는 연동 모듈
// ------------------------------------------------------------------
// 아래 CLAIM_SHEET_API_URL을 배포된 Apps Script 웹앱 URL로 채우면,
// 클레임 현황 페이지에서 엑셀을 업로드할 때 구글 스프레드시트에 저장되고
// 모든 직원의 화면에 자동으로 반영됩니다.
//
// 아직 URL을 채우지 않았다면(빈 문자열) 예전처럼 "이 브라우저에만" 저장되는
// localStorage 방식으로 동작합니다 — 즉, 지금 당장 설정하지 않아도 사이트는
// 정상적으로 동작합니다.
//
// 설정 방법은 apps_script_claim.gs 상단 주석을 참고하세요.
// ------------------------------------------------------------------

const CLAIM_SHEET_API_URL = ''; // 예: 'https://script.google.com/macros/s/AKfycb.../exec'
const CLAIM_SHEET_TOKEN = '0p9o8i7u';

let _claimJsonpCounter = 0;
function claimJsonpRequest(params, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  return new Promise(function(resolve, reject) {
    const cbName = 'claimjsonp_' + Date.now() + '_' + (_claimJsonpCounter++);
    const script = document.createElement('script');
    let done = false, timer;
    function cleanup() {
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    }
    window[cbName] = function(data) { if (done) return; done = true; cleanup(); resolve(data); };
    timer = setTimeout(function() {
      if (done) return; done = true; cleanup(); reject(new Error('요청 시간이 초과되었습니다.'));
    }, timeoutMs);
    script.onerror = function() { if (done) return; done = true; cleanup(); reject(new Error('요청을 보내지 못했습니다.')); };
    const qs = new URLSearchParams(Object.assign({}, params, { callback: cbName })).toString();
    script.src = CLAIM_SHEET_API_URL + '?' + qs;
    document.body.appendChild(script);
  });
}

// ---- localStorage 폴백 (URL 미설정 시에만 사용) ----
function _localExtrasGet(year) {
  try { return JSON.parse(localStorage.getItem('claim_extra_' + year) || '[]'); }
  catch (e) { return []; }
}
function _localExtrasSet(year, arr) {
  localStorage.setItem('claim_extra_' + year, JSON.stringify(arr));
}

let _claimExtrasCache = null; // { '2024':[...], '2025':[...], '2026':[...] }

// 모든 연도의 "업로드 추가분"을 가져옴 (구글 시트 설정 시 전 직원 공용, 미설정 시 이 브라우저 전용)
async function fetchAllClaimExtras() {
  if (_claimExtrasCache) return _claimExtrasCache;
  if (!CLAIM_SHEET_API_URL) {
    const out = {};
    ['2024', '2025', '2026'].forEach(function(y) { out[y] = _localExtrasGet(y); });
    _claimExtrasCache = out;
    return out;
  }
  try {
    const data = await claimJsonpRequest({ token: CLAIM_SHEET_TOKEN, action: 'list' });
    if (data && data.error) throw new Error(data.error);
    const out = { '2024': [], '2025': [], '2026': [] };
    (Array.isArray(data) ? data : []).forEach(function(r) {
      const y = String(r.year || ('20' + String(r.no || '').slice(0, 2)));
      if (!out[y]) out[y] = [];
      out[y].push(r);
    });
    _claimExtrasCache = out;
    return out;
  } catch (e) {
    console.warn('클레임 공유 데이터 불러오기 실패, 이 브라우저의 로컬 데이터로 대체합니다:', e);
    const out = {};
    ['2024', '2025', '2026'].forEach(function(y) { out[y] = _localExtrasGet(y); });
    _claimExtrasCache = out;
    return out;
  }
}

function invalidateClaimExtrasCache() { _claimExtrasCache = null; }

// 신규 클레임 레코드들을 저장 (구글 시트 설정 시 전 직원에게 공유됨)
async function postClaimExtras(year, records) {
  if (!CLAIM_SHEET_API_URL) {
    const cur = _localExtrasGet(year).concat(records);
    _localExtrasSet(year, cur);
    invalidateClaimExtrasCache();
    return { success: true, added: records.length, mode: 'local' };
  }
  const res = await fetch(CLAIM_SHEET_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: CLAIM_SHEET_TOKEN, action: 'addBatch', year: year, records: records })
  });
  const data = await res.json();
  if (!data || data.error || data.success === false) throw new Error((data && data.error) || '업로드 실패');
  invalidateClaimExtrasCache();
  return Object.assign({ mode: 'shared' }, data);
}

// 특정 연도의 업로드 추가분을 전체 삭제 (구글 시트에서도 삭제되므로 전 직원에게 반영됨)
async function resetClaimExtras(year) {
  if (!CLAIM_SHEET_API_URL) {
    localStorage.removeItem('claim_extra_' + year);
    invalidateClaimExtrasCache();
    return { success: true, mode: 'local' };
  }
  const res = await fetch(CLAIM_SHEET_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: CLAIM_SHEET_TOKEN, action: 'resetYear', year: year })
  });
  const data = await res.json();
  if (!data || data.error || data.success === false) throw new Error((data && data.error) || '초기화 실패');
  invalidateClaimExtrasCache();
  return Object.assign({ mode: 'shared' }, data);
}

function isClaimSheetConfigured() { return !!CLAIM_SHEET_API_URL; }
