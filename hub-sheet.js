// hub-sheet.js — CSC · 클레임 진행상황 "실시간 공유" 연동 모듈
// ------------------------------------------------------------------
// 아래 HUB_SHEET_API_URL 에 거래처이력에 쓰는 Apps Script 웹앱 URL을
// 그대로 붙여넣으면(Code.gs를 새 버전으로 재배포한 뒤), CSC/진행상황도
// 같은 스프레드시트의 'CSC' / 'claim_progress' 탭에 저장되어
// 모든 직원의 화면에 실시간으로 공유됩니다.
//
// URL을 비워두면 기존처럼 이 브라우저(localStorage)에만 저장됩니다.
// (설정 전에도 페이지는 정상 동작)
// ------------------------------------------------------------------

var HUB_SHEET_API_URL = ''; // 예: 'https://script.google.com/macros/s/AKfycb.../exec'
var HUB_SHEET_TOKEN   = '0p9o8i7u';

var _hubCounter = 0;
function _hubJsonp(params, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  return new Promise(function (resolve, reject) {
    var cb = 'hubjsonp_' + Date.now() + '_' + (_hubCounter++);
    var script = document.createElement('script');
    var done = false, timer;
    function cleanup() { delete window[cb]; if (script.parentNode) script.parentNode.removeChild(script); clearTimeout(timer); }
    window[cb] = function (data) { if (done) return; done = true; cleanup(); resolve(data); };
    timer = setTimeout(function () { if (done) return; done = true; cleanup(); reject(new Error('요청 시간이 초과되었습니다.')); }, timeoutMs);
    script.onerror = function () { if (done) return; done = true; cleanup(); reject(new Error('요청을 보내지 못했습니다.')); };
    var qs = new URLSearchParams(Object.assign({}, params, { callback: cb, token: HUB_SHEET_TOKEN })).toString();
    script.src = HUB_SHEET_API_URL + '?' + qs;
    document.body.appendChild(script);
  });
}

// 시트별 저장소를 만든다. sheetName = 'CSC' | 'claim_progress'
// 반환 객체: { shared, list(), add(rec), update(rec), remove(id) }
//  - rec 는 반드시 id 필드를 가진다.
//  - HUB_SHEET_API_URL 미설정 시 localStorage 폴백.
function makeHubStore(sheetName, lsKey) {
  var shared = !!HUB_SHEET_API_URL;

  function lsLoad() { try { return JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch (e) { return []; } }
  function lsSave(a) { localStorage.setItem(lsKey, JSON.stringify(a)); }

  return {
    shared: shared,
    sheet: sheetName,

    list: function () {
      if (!shared) return Promise.resolve(lsLoad());
      return _hubJsonp({ sheet: sheetName, action: 'list' }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        return Array.isArray(res) ? res : [];
      });
    },

    add: function (rec) {
      if (!shared) { var a = lsLoad(); a.push(rec); lsSave(a); return Promise.resolve({ success: true }); }
      return _hubJsonp({ sheet: sheetName, action: 'add', record: JSON.stringify(rec) }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        return res;
      });
    },

    update: function (rec) {
      if (!shared) { var a = lsLoad(); var i = a.findIndex(function (x) { return String(x.id) === String(rec.id); }); if (i >= 0) a[i] = rec; lsSave(a); return Promise.resolve({ success: true }); }
      return _hubJsonp({ sheet: sheetName, action: 'update', record: JSON.stringify(rec) }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        return res;
      });
    },

    remove: function (id) {
      if (!shared) { var a = lsLoad().filter(function (x) { return String(x.id) !== String(id); }); lsSave(a); return Promise.resolve({ success: true }); }
      return _hubJsonp({ sheet: sheetName, action: 'delete', id: id }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        return res;
      });
    }
  };
}
