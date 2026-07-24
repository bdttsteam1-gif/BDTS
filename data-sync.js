// data-sync.js — 엑셀 업로드 데이터 "전 직원 공유" 저장 모듈 (Sales Report · 클레임 현황 공용)
// ------------------------------------------------------------------
// 거래처이력/CSC에 쓰는 것과 같은 Apps Script 웹앱을 사용해, 업로드된 데이터를
// 구글 스프레드시트의 'upload_blobs' 탭에 저장합니다. 큰 데이터는 조각(chunk)으로
// 나누어 저장하고, 페이지를 열 때 다시 합쳐서 불러옵니다.
//   → 어떤 기기/브라우저에서 업로드해도 모든 직원의 화면에 반영됩니다.
//
// ★ 준비물 (한 번만):
//   1) 스프레드시트에 'upload_blobs' 탭을 추가 (헤더는 자동 생성됨)
//   2) Code.gs에 doPost가 없다면 APPS_SCRIPT_UPDATE.md의 doPost 코드를 추가 후 재배포
//      (doPost가 없어도 소량 데이터는 JSONP GET으로 자동 폴백되지만,
//       Sales Report처럼 큰 데이터는 doPost가 필요합니다)
// ------------------------------------------------------------------

var DATA_SYNC_URL = (typeof HUB_SHEET_API_URL !== 'undefined' && HUB_SHEET_API_URL) ||
  'https://script.google.com/macros/s/AKfycbxkxRmbkTjnzFciIk6p_I9-8rbVzYZVcs7xO2MPEBkp0X4uOUAf8QmXgebpS7FpYkWxFA/exec';
var DATA_SYNC_TOKEN = (typeof HUB_SHEET_TOKEN !== 'undefined' && HUB_SHEET_TOKEN) || '0p9o8i7u';

var DS_CHUNK_POST = 30000;  // POST 사용 시 조각 크기 (시트 셀 한도 50,000자 이내)
var DS_CHUNK_GET  = 1000;   // JSONP GET 폴백 시 조각 크기 (URL 길이 한도 대비)
var DS_GET_MAX_CHUNKS = 80; // GET 폴백으로 저장 가능한 최대 조각 수 (초과 시 저장 거부)

(function () {
  'use strict';

  var _dsCounter = 0;
  function _dsJsonp(params, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    return new Promise(function (resolve, reject) {
      var cb = 'dsjsonp_' + Date.now() + '_' + (_dsCounter++);
      var script = document.createElement('script');
      var done = false, timer;
      function cleanup() { delete window[cb]; if (script.parentNode) script.parentNode.removeChild(script); clearTimeout(timer); }
      window[cb] = function (data) { if (done) return; done = true; cleanup(); resolve(data); };
      timer = setTimeout(function () { if (done) return; done = true; cleanup(); reject(new Error('요청 시간이 초과되었습니다.')); }, timeoutMs);
      script.onerror = function () { if (done) return; done = true; cleanup(); reject(new Error('요청을 보내지 못했습니다.')); };
      var qs = new URLSearchParams(Object.assign({}, params, { callback: cb, token: DATA_SYNC_TOKEN })).toString();
      script.src = DATA_SYNC_URL + '?' + qs;
      document.body.appendChild(script);
    });
  }

  function _dsPost(payload) {
    return fetch(DATA_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: DATA_SYNC_TOKEN }, payload))
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (data && data.error) throw new Error(data.error);
      return data;
    });
  }

  // POST(doPost) 지원 여부 감지 결과 캐시: null=미확인, true/false
  var _postSupported = null;
  function detectPost(sheetName) {
    if (_postSupported !== null) return Promise.resolve(_postSupported);
    return _dsPost({ sheet: sheetName, action: 'list' }).then(function () {
      _postSupported = true; return true;
    }).catch(function () {
      _postSupported = false; return false;
    });
  }

  // 시트 기반 "blob 저장소": 큰 JSON을 조각으로 나눠 저장/조립
  // 레코드: { id: key@ver#seq, key, ver, seq, total, savedat, data }
  function makeBlobStore(sheetName) {
    var _idsByKey = {}; // 마지막 load 시점의 (key → 기존 레코드 id 목록) — 이후 정리용
    var shared = !!DATA_SYNC_URL;

    function addRecord(rec, usePost) {
      if (usePost) return _dsPost({ sheet: sheetName, action: 'add', record: JSON.stringify(rec) });
      return _dsJsonp({ sheet: sheetName, action: 'add', record: JSON.stringify(rec) }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        return res;
      });
    }
    function removeRecord(id, usePost) {
      if (usePost) return _dsPost({ sheet: sheetName, action: 'delete', id: id });
      return _dsJsonp({ sheet: sheetName, action: 'delete', id: id }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        return res;
      });
    }

    return {
      shared: shared,
      sheet: sheetName,

      // 시트의 모든 blob을 불러와 key별 최신 완성본을 조립: { key: { ver, data } }
      loadAll: function () {
        if (!shared) return Promise.resolve({});
        return _dsJsonp({ sheet: sheetName, action: 'list' }, 60000).then(function (rows) {
          if (rows && rows.error) throw new Error(rows.error);
          if (!Array.isArray(rows)) rows = [];
          // 같은 id가 여러 번 저장되었으면 마지막 것만 사용
          var byId = {};
          rows.forEach(function (r) { if (r && r.id != null) byId[String(r.id)] = r; });
          var groups = {}; // key → ver → {seq: data}
          _idsByKey = {};
          Object.keys(byId).forEach(function (id) {
            var r = byId[id];
            var key = String(r.key || ''), ver = String(r.ver || '');
            if (!key || !ver) return;
            if (!groups[key]) groups[key] = {};
            if (!groups[key][ver]) groups[key][ver] = { total: parseInt(r.total, 10) || 0, parts: {} };
            groups[key][ver].parts[parseInt(r.seq, 10) || 0] = String(r.data == null ? '' : r.data);
            if (!_idsByKey[key]) _idsByKey[key] = [];
            _idsByKey[key].push({ id: id, ver: ver });
          });
          var out = {};
          Object.keys(groups).forEach(function (key) {
            var vers = Object.keys(groups[key]).sort(function (a, b) { return Number(b) - Number(a); });
            for (var i = 0; i < vers.length; i++) {
              var g = groups[key][vers[i]];
              var full = '', complete = g.total > 0;
              for (var s = 0; s < g.total; s++) {
                if (g.parts[s] === undefined) { complete = false; break; }
                full += g.parts[s];
              }
              if (!complete) continue;
              try {
                out[key] = { ver: Number(vers[i]), data: JSON.parse(full) };
                break; // 최신 완성본을 찾았으면 종료
              } catch (e) { /* 손상된 버전 → 이전 버전 시도 */ }
            }
          });
          return out;
        });
      },

      // key에 obj 저장 (통째로 교체). onProgress(done, total) 콜백 제공.
      save: function (key, obj, onProgress) {
        if (!shared) return Promise.reject(new Error('공유 저장소 URL이 설정되지 않았습니다.'));
        var str = JSON.stringify(obj);
        var self = this;
        return detectPost(sheetName).then(function (usePost) {
          var chunkSize = usePost ? DS_CHUNK_POST : DS_CHUNK_GET;
          var total = Math.max(1, Math.ceil(str.length / chunkSize));
          if (!usePost && total > DS_GET_MAX_CHUNKS) {
            throw new Error('데이터가 커서 공유 저장에 실패했습니다. Apps Script에 doPost 추가가 필요합니다 (APPS_SCRIPT_UPDATE.md 참고).');
          }
          var ver = Date.now();
          var savedat = new Date().toISOString();
          var i = 0;
          function next() {
            if (i >= total) return Promise.resolve();
            var rec = {
              id: key + '@' + ver + '#' + i,
              key: key, ver: ver, seq: i, total: total,
              savedat: savedat,
              data: str.substr(i * chunkSize, chunkSize)
            };
            return addRecord(rec, usePost).then(function () {
              i++;
              if (onProgress) onProgress(i, total);
              return next();
            });
          }
          return next().then(function () {
            // 이전 버전 조각 정리 (실패해도 무시 — 최신 버전만 읽으므로 문제 없음)
            self._prune(key, ver, usePost);
            return { ver: ver, chunks: total };
          });
        });
      },

      _prune: function (key, keepVer, usePost) {
        var olds = (_idsByKey[key] || []).filter(function (x) { return Number(x.ver) < keepVer; });
        olds = olds.slice(0, 300);
        var i = 0;
        (function step() {
          if (i >= olds.length) return;
          removeRecord(olds[i].id, usePost).catch(function () {}).then(function () { i++; step(); });
        })();
      }
    };
  }

  window.makeBlobStore = makeBlobStore;
  window.dataSyncConfigured = function () { return !!DATA_SYNC_URL; };
})();
